//! Strict four-channel codec and length-prefixed framing.

#![allow(non_snake_case)] // wire field names stay camelCase to match the Node schema.

use std::collections::VecDeque;
use std::io::{Read, Write};

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_RECORD_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum HostProjection {
    #[serde(rename = "projection_window")]
    Window {
        protocolVersion: u32,
        publicationRevision: u64,
        index: u32,
        cells: Vec<Cell>,
        views: Vec<View>,
    },
    #[serde(rename = "projection_commit")]
    Commit {
        protocolVersion: u32,
        publicationRevision: u64,
        totalWindows: u32,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)] // Stable cell IDs are retained for replacement and future selection state.
pub struct Cell {
    pub id: String,
    pub kind: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Line {
    pub text: String,
    #[serde(default)]
    pub style: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct View {
    pub id: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChildAction {
    #[serde(rename = "submit")]
    Submit {
        protocolVersion: u32,
        actionId: String,
        sessionId: String,
        text: String,
        attachments: Vec<serde_json::Value>,
        mode: String,
    },
    #[serde(rename = "cancel")]
    Cancel {
        protocolVersion: u32,
        actionId: String,
        sessionId: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)] // Closed control variants are decoded even when the renderer needs no payload field yet.
pub enum HostControl {
    #[serde(rename = "hello")]
    Hello {
        protocolVersion: u32,
        hostVersion: String,
        minProtocolVersion: u32,
        maxProtocolVersion: u32,
        maxRecordBytes: u32,
        maxQueuedBytes: u32,
    },
    #[serde(rename = "delivery_ledger")]
    Ledger {
        protocolVersion: u32,
        channel: String,
        sequence: u64,
        recordBytes: u32,
    },
    #[serde(rename = "ack")]
    Ack {
        protocolVersion: u32,
        channel: String,
        sequence: u64,
    },
    #[serde(rename = "capacity")]
    Capacity {
        protocolVersion: u32,
        channel: String,
        availableBytes: u32,
    },
    #[serde(rename = "shutdown")]
    Shutdown {
        protocolVersion: u32,
        reason: String,
    },
    #[serde(rename = "fatal")]
    Fatal {
        protocolVersion: u32,
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(dead_code)] // Capacity and fatal are protocol-owned outbound variants used by boundary failures.
pub enum ChildControl {
    #[serde(rename = "ready")]
    Ready {
        protocolVersion: u32,
        childVersion: String,
        selectedProtocolVersion: u32,
        target: String,
    },
    #[serde(rename = "delivery_ledger")]
    Ledger {
        protocolVersion: u32,
        channel: String,
        sequence: u64,
        recordBytes: u32,
    },
    #[serde(rename = "ack")]
    Ack {
        protocolVersion: u32,
        channel: String,
        sequence: u64,
        projectionRevision: u64,
    },
    #[serde(rename = "request_resync")]
    Resync {
        protocolVersion: u32,
        expectedSequence: u64,
        observedSequence: u64,
        observedProjectionRevision: u64,
        reason: String,
    },
    #[serde(rename = "capacity")]
    Capacity {
        protocolVersion: u32,
        channel: String,
        availableBytes: u32,
    },
    #[serde(rename = "shutdown")]
    Shutdown {
        protocolVersion: u32,
        reason: String,
    },
    #[serde(rename = "fatal")]
    Fatal {
        protocolVersion: u32,
        code: String,
        message: String,
    },
}

pub enum Channel {
    Projection,
    HostControl,
}

pub struct FrameReader<'a> {
    input: &'a mut dyn Read,
    _channel: Channel,
    buffer: Vec<u8>,
    eof: bool,
}

impl<'a> FrameReader<'a> {
    pub fn new(input: &'a mut dyn Read, channel: Channel) -> Self {
        Self {
            input,
            _channel: channel,
            buffer: Vec::with_capacity(64 * 1024),
            eof: false,
        }
    }

    pub fn read_one(&mut self) -> anyhow::Result<Option<Vec<u8>>> {
        loop {
            if self.buffer.len() >= 4 {
                let length = u32::from_be_bytes(self.buffer[0..4].try_into()?) as usize;
                if length == 0 || length > MAX_RECORD_BYTES {
                    anyhow::bail!("frame length out of range: {}", length);
                }
                if self.buffer.len() >= 4 + length {
                    let body = self.buffer[4..4 + length].to_vec();
                    self.buffer.drain(..4 + length);
                    return Ok(Some(body));
                }
            }
            let mut chunk = [0u8; 16 * 1024];
            let read = match self.input.read(&mut chunk) {
                Ok(read) => read,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(None),
                Err(error) => return Err(error.into()),
            };
            if read == 0 {
                self.eof = true;
                if self.buffer.is_empty() {
                    return Ok(None);
                }
                anyhow::bail!("unexpected EOF with partial frame");
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
    }

    pub fn is_eof(&self) -> bool {
        self.eof
    }
}

#[derive(Debug)]
pub enum PairOutcome {
    Pending,
    Accepted { body: Vec<u8>, sequence: u64 },
    ForwardGap { expected: u64, observed: u64 },
}

pub struct DeliveryPair {
    records: VecDeque<Vec<u8>>,
    ledgers: VecDeque<HostControl>,
    pending_bytes: usize,
    expected_sequence: u64,
}

impl DeliveryPair {
    pub fn new() -> Self {
        Self {
            records: VecDeque::new(),
            ledgers: VecDeque::new(),
            pending_bytes: 0,
            expected_sequence: 1,
        }
    }

    pub fn push_record(&mut self, body: Vec<u8>) -> anyhow::Result<()> {
        self.pending_bytes += body.len();
        self.records.push_back(body);
        self.assert_bounds()
    }

    pub fn push_ledger(&mut self, ledger: HostControl) -> anyhow::Result<()> {
        self.ledgers.push_back(ledger);
        self.assert_bounds()
    }

    pub fn accept(&mut self) -> anyhow::Result<PairOutcome> {
        let Some(body) = self.records.pop_front() else {
            return Ok(PairOutcome::Pending);
        };
        let Some(ledger) = self.ledgers.pop_front() else {
            self.records.push_front(body);
            return Ok(PairOutcome::Pending);
        };
        self.pending_bytes -= body.len();
        let HostControl::Ledger {
            channel,
            sequence,
            recordBytes,
            ..
        } = ledger
        else {
            anyhow::bail!("projection delivery ledger channel mismatch");
        };
        if channel != "projection" {
            anyhow::bail!("projection ledger has wrong channel: {}", channel);
        }
        if usize::try_from(recordBytes)? != body.len() {
            anyhow::bail!(
                "projection ledger recordBytes {} does not match {}",
                recordBytes,
                body.len()
            );
        }
        if sequence == 0 || sequence > MAX_SAFE_SEQUENCE {
            anyhow::bail!("projection ledger sequence is outside the safe integer range");
        }
        if sequence > self.expected_sequence {
            let expected = self.expected_sequence;
            self.records.clear();
            self.ledgers.clear();
            self.pending_bytes = 0;
            self.expected_sequence = sequence
                .checked_add(1)
                .ok_or_else(|| anyhow::anyhow!("projection ledger sequence exhausted"))?;
            return Ok(PairOutcome::ForwardGap {
                expected,
                observed: sequence,
            });
        }
        if sequence < self.expected_sequence {
            anyhow::bail!(
                "projection ledger sequence rewind: expected {}, observed {}",
                self.expected_sequence,
                sequence
            );
        }
        self.expected_sequence = self
            .expected_sequence
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("projection ledger sequence exhausted"))?;
        Ok(PairOutcome::Accepted { body, sequence })
    }

    pub fn finish(&mut self) -> anyhow::Result<()> {
        if !self.records.is_empty() || !self.ledgers.is_empty() {
            anyhow::bail!("projection channel closed with unpaired business or ledger records");
        }
        Ok(())
    }

    pub fn discard_pending(&mut self) {
        self.records.clear();
        self.ledgers.clear();
        self.pending_bytes = 0;
    }

    fn assert_bounds(&self) -> anyhow::Result<()> {
        if self.records.len() + self.ledgers.len() > 256 || self.pending_bytes > 16 * 1024 * 1024 {
            anyhow::bail!("projection delivery pairing buffer overflow");
        }
        Ok(())
    }
}

pub fn encode<T: Serialize>(record: &T) -> anyhow::Result<Vec<u8>> {
    let body = serde_json::to_vec(record)?;
    if body.len() > MAX_RECORD_BYTES {
        anyhow::bail!("record exceeds {} bytes", MAX_RECORD_BYTES);
    }
    let len = body.len() as u32;
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

pub fn write_frame<T: Serialize>(writer: &mut dyn Write, record: &T) -> anyhow::Result<()> {
    writer.write_all(&encode(record)?)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger(sequence: u64, record_bytes: u32) -> HostControl {
        HostControl::Ledger {
            protocolVersion: PROTOCOL_VERSION,
            channel: "projection".into(),
            sequence,
            recordBytes: record_bytes,
        }
    }

    #[test]
    fn accepts_one_business_record_with_its_ledger() {
        let mut pair = DeliveryPair::new();
        pair.push_record(b"{}".to_vec()).unwrap();
        pair.push_ledger(ledger(1, 2)).unwrap();
        assert!(matches!(
            pair.accept().unwrap(),
            PairOutcome::Accepted { sequence: 1, .. }
        ));
        pair.finish().unwrap();
    }

    #[test]
    fn forward_gap_discards_pending_and_continues_after_observed_sequence() {
        let mut pair = DeliveryPair::new();
        pair.push_record(b"{}".to_vec()).unwrap();
        pair.push_ledger(ledger(3, 2)).unwrap();
        assert!(matches!(
            pair.accept().unwrap(),
            PairOutcome::ForwardGap {
                expected: 1,
                observed: 3
            }
        ));
        pair.push_record(b"[]".to_vec()).unwrap();
        pair.push_ledger(ledger(4, 2)).unwrap();
        assert!(matches!(
            pair.accept().unwrap(),
            PairOutcome::Accepted { sequence: 4, .. }
        ));
    }

    #[test]
    fn rejects_replay_and_byte_mismatch() {
        let mut replay = DeliveryPair::new();
        replay.push_record(b"{}".to_vec()).unwrap();
        replay.push_ledger(ledger(1, 2)).unwrap();
        replay.accept().unwrap();
        replay.push_record(b"{}".to_vec()).unwrap();
        replay.push_ledger(ledger(1, 2)).unwrap();
        assert!(replay.accept().unwrap_err().to_string().contains("rewind"));

        let mut mismatch = DeliveryPair::new();
        mismatch.push_record(b"{}".to_vec()).unwrap();
        mismatch.push_ledger(ledger(1, 1)).unwrap();
        assert!(mismatch
            .accept()
            .unwrap_err()
            .to_string()
            .contains("recordBytes"));
    }
}
