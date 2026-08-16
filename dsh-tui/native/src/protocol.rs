//! Wire protocol shared with the Node host.

#![allow(non_snake_case)] // wire field names stay camelCase to match the Node schema.

use std::io::{Read, Write};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_RECORD_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, serde::Deserialize)]
#[allow(dead_code)] // projection window fields are part of the wire contract for future multi-window publications.
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostProjection {
    #[serde(rename = "projection_window")]
    Window { publicationRevision: u32, index: u32, cells: Vec<Cell>, views: Vec<View> },
    #[serde(rename = "projection_commit")]
    Commit { publicationRevision: u32, totalWindows: u32 },
}

#[derive(Debug, Clone, serde::Deserialize)]
#[allow(dead_code)] // cell ids are part of the wire contract even when the v1 renderer draws text only.
pub struct Cell {
    pub id: String,
    pub kind: String,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Line {
    pub text: String,
    #[serde(default)]
    pub style: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct View {
    pub id: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, serde::Serialize)]
#[allow(dead_code)] // action shutdown is part of the wire contract; runtime shutdown goes through child control.
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChildAction {
    #[serde(rename = "submit")]
    Submit { protocolVersion: u32, actionId: String, sessionId: String, text: String, mode: String },
    #[serde(rename = "cancel")]
    Cancel { protocolVersion: u32, actionId: String, sessionId: String },
    #[serde(rename = "shutdown")]
    Shutdown { protocolVersion: u32, actionId: String, reason: String },
}

#[derive(Debug, Clone, serde::Deserialize)]
#[allow(dead_code)] // control schema variants are part of the wire contract even when v1 does not construct every one.
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostControl {
    #[serde(rename = "hello")]
    Hello { hostVersion: String, maxRecordBytes: u32, maxQueuedBytes: u32 },
    #[serde(rename = "ack")]
    Ack { channel: String, sequence: u32, projectionRevision: Option<u32> },
    #[serde(rename = "capacity")]
    Capacity { channel: String, availableBytes: u32 },
    #[serde(rename = "shutdown")]
    Shutdown { reason: String },
    #[serde(rename = "fatal")]
    Fatal { code: String, message: String },
    #[serde(rename = "delivery_ledger")]
    Ledger { channel: String, sequence: u32, recordBytes: u32 },
}

#[derive(Debug, Clone, serde::Serialize)]
#[allow(dead_code)] // child control variants mirror the host schema for future resync/ledger traffic.
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChildControl {
    #[serde(rename = "ready")]
    Ready { protocolVersion: u32, childVersion: String, selectedProtocolVersion: u32, target: String },
    #[serde(rename = "delivery_ledger")]
    Ledger { protocolVersion: u32, channel: String, sequence: u32, recordBytes: u32 },
    #[serde(rename = "ack")]
    Ack { protocolVersion: u32, channel: String, sequence: u32 },
    #[serde(rename = "request_resync")]
    Resync { protocolVersion: u32, expectedSequence: u32, observedSequence: u32, observedProjectionRevision: u32, reason: String },
    #[serde(rename = "shutdown")]
    Shutdown { protocolVersion: u32, reason: String },
    #[serde(rename = "fatal")]
    Fatal { protocolVersion: u32, code: String, message: String },
}

pub fn encode<T: serde::Serialize>(record: &T) -> anyhow::Result<Vec<u8>> {
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

pub struct FrameReader<'a> {
    input: &'a mut dyn Read,
    buffer: Vec<u8>,
}

impl<'a> FrameReader<'a> {
    pub fn new(input: &'a mut dyn Read) -> Self {
        Self { input, buffer: Vec::with_capacity(64 * 1024) }
    }

    pub fn next_available(&mut self) -> anyhow::Result<Option<Vec<u8>>> {
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
                if self.buffer.is_empty() {
                    return Ok(None);
                }
                anyhow::bail!("unexpected EOF with partial frame");
            }
            self.buffer.extend_from_slice(&chunk[..read]);
        }
    }
}

pub fn write_frame<T: serde::Serialize>(writer: &mut dyn Write, record: &T) -> anyhow::Result<()> {
    writer.write_all(&encode(record)?)?;
    writer.flush()?;
    Ok(())
}
