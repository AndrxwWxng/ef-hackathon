#!/usr/bin/env node
// lib/multimodal/cli.ts — CLI for ingesting a single multimodal source.
//
// Usage:
//   node --import tsx lib/multimodal/cli.ts --kind text --label "Notes" --text "..."
//   node --import tsx lib/multimodal/cli.ts --kind audio --label "Voice" --file path/to.mp3
//   node --import tsx lib/multimodal/cli.ts --kind video --label "Demo" --file path/to.mp4
//
// Optional:
//   --json             Print the full IngestResult as JSON
//   --out <path>       Write JSON to a file
//   --quiet            Suppress per-step logs
//
// Reads OPENAI_API_KEY from the environment. Without it, audio/video fall back
// to a deterministic local mock so the pipeline shape stays the same.

import { promises as fs } from "node:fs";
import path from "node:path";

import { ingestSource, type IngestInput } from "./index";

type CliArgs = {
  kind: "text" | "audio" | "video";
  label: string;
  text?: string;
  file?: string;
  json: boolean;
  out?: string;
  quiet: boolean;
  origin?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { kind: "text", label: "CLI source", json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--kind": args.kind = next() as CliArgs["kind"]; break;
      case "--label": args.label = next(); break;
      case "--text": args.text = next(); break;
      case "--file": args.file = next(); break;
      case "--origin": args.origin = next(); break;
      case "--json": args.json = true; break;
      case "--out": args.out = next(); break;
      case "--quiet": args.quiet = true; break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  console.log(`multimodal/cli — ingest a single source into structured context

  --kind <text|audio|video>   Source modality (default: text)
  --label <label>             Human-readable label
  --text <text>               Inline text (for --kind text)
  --file <path>               File path (for --kind audio|video)
  --origin <text>             Where this came from (commit URL, doc title, ...)
  --json                      Print the full IngestResult as JSON
  --out <path>                Write JSON to a file
  --quiet                     Suppress per-step logs
  --help, -h                  This message

Reads OPENAI_API_KEY for real Whisper transcription. Without it, audio/video
fall back to a deterministic local mock so the pipeline shape is preserved.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = await buildInput(args);
  const result = await ingestSource(input, {
    onLog: (line) => {
      if (!args.quiet) console.log(`  ${line}`);
    },
    onStep: (step) => {
      if (!args.quiet) {
        const status = step.status.padEnd(8);
        console.log(`  ${step.name.padEnd(10)} ${status} ${step.ms}ms · ${step.detail}`);
      }
    },
  });

  if (args.json) {
    const payload = JSON.stringify(result, null, 2);
    if (args.out) {
      await fs.writeFile(path.resolve(args.out), payload);
      console.log(`wrote ${args.out}`);
    } else {
      console.log(payload);
    }
    return;
  }

  console.log("\n── summary ──");
  console.log(`id:        ${result.id}`);
  console.log(`modality:  ${result.modality}`);
  console.log(`label:     ${result.source.label}`);
  console.log(`origin:    ${result.source.origin}`);
  if (result.source.durationMs) console.log(`duration:  ${(result.source.durationMs / 1000).toFixed(1)}s`);
  if (result.source.bytes) console.log(`size:      ${(result.source.bytes / 1024).toFixed(1)} KB`);
  if (result.source.transcript) {
    console.log(`words:     ${result.source.transcript.fullText.split(/\s+/).filter(Boolean).length}`);
    console.log(`model:     ${result.source.transcript.model ?? "unknown"}`);
  }
  if (result.source.takeaways) {
    console.log(`\nTone: ${result.source.takeaways.tone}`);
    console.log(`Themes: ${result.source.takeaways.themes.join(", ") || "(none)"}`);
    console.log(`\nSummary:\n  ${result.source.takeaways.summary}`);
    if (result.source.takeaways.bullets.length) {
      console.log("\nBullets:");
      for (const bullet of result.source.takeaways.bullets) console.log(`  · ${bullet}`);
    }
    if (result.source.takeaways.quotes.length) {
      console.log("\nQuotes:");
      for (const quote of result.source.takeaways.quotes) console.log(`  "${quote}"`);
    }
  }
}

async function buildInput(args: CliArgs): Promise<IngestInput> {
  const origin = args.origin ?? "cli";
  if (args.kind === "text") {
    if (!args.text && !args.file) {
      console.error("text ingest needs --text or --file");
      process.exit(2);
    }
    const text = args.text ?? (await fs.readFile(args.file!, "utf8"));
    return { modality: "text", label: args.label, text, origin };
  }
  if (!args.file) {
    console.error(`${args.kind} ingest needs --file`);
    process.exit(2);
  }
  if (args.kind === "audio") return { modality: "audio", label: args.label, filePath: path.resolve(args.file), origin };
  return { modality: "video", label: args.label, filePath: path.resolve(args.file), origin };
}

main().catch((err) => {
  console.error(`\n${err?.stack || err}`);
  process.exit(1);
});