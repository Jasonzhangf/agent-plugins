# dsh-memory compaction provider

This package replaces the `compaction-basic` row with the same DSH compaction
engine and enables its opt-in `memoryPrompt` marker. Surface replacement,
token pressure, retry, and cancellation remain owned by DSH; dsh-memory only
turns on the typed memory output request.
