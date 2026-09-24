//! 场次的弹幕密度：每个写完的分段旁的弹幕 XML（`<d p="秒,…">`），按场次时间分桶计数。
//!
//! 弹幕文件的时间是相对写入端开始写的时刻，和分段起点大致对齐（误差在一两秒内），
//! 用来画密度曲线足够；不用于落刀。

use super::store::{SegmentRow, SegmentState};
use std::path::Path;

/// 一个分段的弹幕文件超过这么大就不读（正常几小时也就几十 MB）
const MAX_XML_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Density {
    pub bucket_ms: i64,
    /// 第 i 个桶是场次时间 `[i * bucket_ms, (i + 1) * bucket_ms)` 内的弹幕条数
    pub counts: Vec<u32>,
    pub total: u64,
    /// 读到了弹幕文件的分段数
    pub segments: u32,
}

/// 弹幕 XML 里每条 `<d p="秒,…">` 的秒数。正文里的 `<` 都转义过，按字面扫描不会误判。
pub fn danmaku_offsets(xml: &str) -> impl Iterator<Item = f64> + '_ {
    xml.match_indices("<d p=\"").filter_map(|(at, open)| {
        let rest = &xml[at + open.len()..];
        let end = rest.find([',', '"'])?;
        rest[..end]
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|t| t.is_finite() && *t >= 0.0)
    })
}

/// 读场次里写完的分段的弹幕文件并分桶；读不了的文件跳过。
pub fn density(segments: &[SegmentRow], duration_ms: i64, bucket_ms: i64) -> Density {
    let bucket_ms = bucket_ms.max(1);
    let len = (duration_ms.max(0) + bucket_ms - 1) / bucket_ms;
    let mut counts = vec![0u32; len as usize];
    let mut total = 0u64;
    let mut read = 0u32;
    for segment in segments {
        if segment.state != SegmentState::Finished {
            continue;
        }
        let Some(path) = segment.danmaku_path.as_deref().map(Path::new) else {
            continue;
        };
        let Ok(meta) = std::fs::metadata(path) else {
            continue;
        };
        if meta.len() > MAX_XML_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        read += 1;
        let xml = String::from_utf8_lossy(&bytes);
        let end = segment.end_ms.unwrap_or(i64::MAX);
        for offset in danmaku_offsets(&xml) {
            let t = (segment.start_ms + (offset * 1000.0) as i64).min(end);
            let i = (t / bucket_ms) as usize;
            if let Some(c) = counts.get_mut(i) {
                *c += 1;
                total += 1;
            }
        }
    }
    Density {
        bucket_ms,
        counts,
        total,
        segments: read,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(id: i64, start_ms: i64, end_ms: i64, danmaku: Option<&Path>) -> SegmentRow {
        SegmentRow {
            id,
            session_id: 1,
            path: format!("{id}.flv"),
            container: "flv".into(),
            state: SegmentState::Finished,
            start_ms,
            end_ms: Some(end_ms),
            bytes: Some(1),
            index_path: None,
            danmaku_path: danmaku.map(|p| p.to_string_lossy().into_owned()),
            gap_before_ms: 0,
        }
    }

    #[test]
    fn reads_offsets_and_ignores_escaped_text_and_other_elements() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<i>
	<d p="1.5,1,25,16777215,1700000000000,0,1,0">a &lt;d p="9,1"&gt;</d>
	<s timestamp="1" uid="2">sc</s>
	<d p="bad,1">x</d>
	<d p="61.0,1,25,16777215,1700000000000,0,1,0">b</d>
</i>"#;
        let offsets: Vec<f64> = danmaku_offsets(xml).collect();
        assert_eq!(offsets, [1.5, 61.0]);
    }

    #[test]
    fn buckets_by_session_time_across_segments() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.xml");
        let b = dir.path().join("b.xml");
        std::fs::write(
            &a,
            r#"<i><d p="1,1">x</d><d p="9.9,1">x</d><d p="30,1">x</d></i>"#,
        )
        .unwrap();
        std::fs::write(&b, r#"<i><d p="0.5,1">x</d></i>"#).unwrap();
        let mut deleted = segment(3, 40_000, 50_000, Some(&a));
        deleted.state = SegmentState::Deleted;
        let segments = [
            segment(1, 0, 20_000, Some(&a)),
            segment(2, 25_000, 35_000, Some(&b)),
            deleted,
            segment(4, 50_000, 60_000, Some(&dir.path().join("missing.xml"))),
            segment(5, 60_000, 70_000, None),
        ];
        let d = density(&segments, 70_000, 10_000);
        // 30 秒那条超出了分段 1 的末尾，算在末尾（20 秒）那个桶；分段 2 的那条在 25.5 秒
        assert_eq!(d.counts, [2, 0, 2, 0, 0, 0, 0]);
        assert_eq!((d.total, d.segments, d.bucket_ms), (4, 2, 10_000));
        let d = density(&segments, 0, 10_000);
        assert!(d.counts.is_empty() && d.total == 0);
    }
}
