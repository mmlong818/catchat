import type { TranscriptEntry } from '../../shared/types';

const MAX_PARAGRAPH_CHARS = 120;     // 单段落最大约 100-120 字
const SILENCE_GAP_MS = 4000;          // 同说话人停顿超过 4s 另起一段
const PARTIAL_FLUSH_MS = 1500;        // partial 超过此时长强制更新显示

export interface Paragraph {
  id: string;
  speaker: string;
  speakerName: string;
  text: string;        // 已确认部分（多句拼接）
  partial: string;     // 当前未确认句子
  startTs: number;
  lastTs: number;
  isOpen: boolean;     // 仍可追加 (同人 + 未达上限 + 停顿短)
}

export type TranscriptListener = (paragraphs: Paragraph[]) => void;

export class TranscriptStore {
  private paragraphs: Paragraph[] = [];
  private listeners: TranscriptListener[] = [];
  private meetingStart = Date.now();
  private nextId = 1;

  subscribe(cb: TranscriptListener) {
    this.listeners.push(cb);
    cb(this.snapshot());
    return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
  }

  /** Ingest a sentence-level transcript entry (final or partial) */
  ingest(entry: TranscriptEntry) {
    const now = entry.ts;
    const open = this.findOpenForSpeaker(entry.speaker, now);

    // Close any open paragraphs by OTHER speakers (interruption)
    for (const p of this.paragraphs) {
      if (p.isOpen && p.speaker !== entry.speaker) p.isOpen = false;
    }

    if (entry.isFinal) {
      const finalText = entry.text.trim();
      if (!finalText) { this.emit(); return; }

      if (open) {
        // Append to existing open paragraph
        open.text = mergeText(open.text, finalText);
        open.partial = '';
        open.lastTs = now;
        // Close if reaches char limit
        if (visibleLen(open.text) >= MAX_PARAGRAPH_CHARS) open.isOpen = false;
      } else {
        this.paragraphs.push({
          id: `p${this.nextId++}`,
          speaker: entry.speaker,
          speakerName: entry.speakerName,
          text: finalText,
          partial: '',
          startTs: now,
          lastTs: now,
          isOpen: visibleLen(finalText) < MAX_PARAGRAPH_CHARS,
        });
      }
    } else {
      // partial
      if (open) {
        open.partial = entry.text;
        open.lastTs = now;
      } else {
        this.paragraphs.push({
          id: `p${this.nextId++}`,
          speaker: entry.speaker,
          speakerName: entry.speakerName,
          text: '',
          partial: entry.text,
          startTs: now,
          lastTs: now,
          isOpen: true,
        });
      }
    }

    this.emit();
  }

  private findOpenForSpeaker(speakerId: string, now: number): Paragraph | null {
    for (let i = this.paragraphs.length - 1; i >= 0; i--) {
      const p = this.paragraphs[i];
      if (p.speaker !== speakerId) return null; // 不同人插队 → 旧段已被打断
      if (!p.isOpen) return null;
      if (now - p.lastTs > SILENCE_GAP_MS) {
        p.isOpen = false;
        return null;
      }
      return p;
    }
    return null;
  }

  snapshot(): Paragraph[] {
    return [...this.paragraphs];
  }

  /** Force close all open paragraphs (e.g. on meeting end) */
  flush() {
    for (const p of this.paragraphs) p.isOpen = false;
    this.emit();
  }

  private emit() {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  toMarkdown(roomName: string): string {
    const start = new Date(this.meetingStart);
    const lines: string[] = [
      `# 会议纪要 - ${roomName}`,
      ``,
      `**开始时间**：${start.toLocaleString('zh-CN')}`,
      `**段落数**：${this.paragraphs.length}`,
      ``,
      `---`,
      ``,
    ];
    for (const p of this.paragraphs) {
      const t = new Date(p.startTs).toLocaleTimeString('zh-CN', { hour12: false });
      const text = (p.text + (p.partial ? ' ' + p.partial : '')).trim();
      if (!text) continue;
      lines.push(`**[${t}] ${p.speakerName}**`);
      lines.push('');
      lines.push(text);
      lines.push('');
    }
    return lines.join('\n');
  }

  reset() {
    this.paragraphs = [];
    this.meetingStart = Date.now();
    this.emit();
  }
}

function visibleLen(s: string) {
  // Treat any non-whitespace char (incl. CJK) as 1 unit
  return s.replace(/\s+/g, '').length;
}

function mergeText(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  // 中文之间不加空格；末尾有标点/空格则直接连接
  const last = a[a.length - 1];
  const isCJK = /[一-鿿　-〿＀-￯]/.test(last);
  const isPunct = /[\s，。！？、；：,.!?;:]/.test(last);
  if (isPunct) return a + b;
  if (isCJK) return a + b;
  return a + ' ' + b;
}

void PARTIAL_FLUSH_MS;
