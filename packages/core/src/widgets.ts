import type { Value } from './types';
import { valuesEqual } from './values';

export const CONTROL = 'control_after_generate';
const CONTROL_VALUES = new Set(['fixed', 'increment', 'decrement', 'randomize']);

export function isControlValue(v: unknown, prev: unknown): boolean {
  return typeof v === 'string' && CONTROL_VALUES.has(v) && typeof prev === 'number' && Number.isInteger(prev);
}

const BUILTIN: Record<string, string[][]> = {
  KSampler: [['seed', CONTROL, 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']],
  KSamplerAdvanced: [
    ['add_noise', 'noise_seed', CONTROL, 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
  ],
  CheckpointLoaderSimple: [['ckpt_name']],
  CheckpointLoader: [['config_name', 'ckpt_name']],
  unCLIPCheckpointLoader: [['ckpt_name']],
  LoraLoader: [['lora_name', 'strength_model', 'strength_clip']],
  LoraLoaderModelOnly: [['lora_name', 'strength_model']],
  CLIPTextEncode: [['text']],
  CLIPSetLastLayer: [['stop_at_clip_layer']],
  EmptyLatentImage: [['width', 'height', 'batch_size']],
  EmptySD3LatentImage: [['width', 'height', 'batch_size']],
  VAELoader: [['vae_name']],
  SaveImage: [['filename_prefix']],
  LoadImage: [['image', 'upload']],
  LoadImageMask: [['image', 'channel', 'upload']],
  ControlNetLoader: [['control_net_name']],
  DiffControlNetLoader: [['control_net_name']],
  ControlNetApply: [['strength']],
  ControlNetApplyAdvanced: [['strength', 'start_percent', 'end_percent']],
  UpscaleModelLoader: [['model_name']],
  ImageScale: [['upscale_method', 'width', 'height', 'crop']],
  ImageScaleBy: [['upscale_method', 'scale_by']],
  LatentUpscale: [['upscale_method', 'width', 'height', 'crop']],
  LatentUpscaleBy: [['upscale_method', 'scale_by']],
  UNETLoader: [['unet_name', 'weight_dtype']],
  CLIPLoader: [['clip_name', 'type'], ['clip_name', 'type', 'device']],
  DualCLIPLoader: [['clip_name1', 'clip_name2', 'type'], ['clip_name1', 'clip_name2', 'type', 'device']],
  CLIPVisionLoader: [['clip_name']],
  StyleModelLoader: [['style_model_name']],
  FluxGuidance: [['guidance']],
  KSamplerSelect: [['sampler_name']],
  BasicScheduler: [['scheduler', 'steps', 'denoise']],
  RandomNoise: [['noise_seed', CONTROL]],
  CFGGuider: [['cfg']],
  ConditioningSetArea: [['width', 'height', 'x', 'y', 'strength']],
  ConditioningSetTimestepRange: [['start', 'end']],
  VAEEncodeForInpaint: [['grow_mask_by']],
  RepeatLatentBatch: [['amount']],
  SaveAnimatedWEBP: [['filename_prefix', 'fps', 'lossless', 'quality', 'method']],
};

export type WidgetNames = readonly string[];

// A name source is used only if it explains every widget position. Otherwise values stay positional.
export class NameRegistry {
  private learned = new Map<string, WidgetNames>();

  learn(type: string, wv: readonly Value[], apiInputs: Record<string, unknown>): void {
    const key = `${type}|${wv.length}`;
    if (this.learned.has(key)) return;
    const names = alignWithApi(wv, apiInputs);
    if (names) this.learned.set(key, names);
  }

  resolve(type: string, wv: readonly Value[], widgetInputNames?: string[]): WidgetNames | undefined {
    const learned = this.learned.get(`${type}|${wv.length}`);
    if (learned && fits(learned, wv)) return learned;
    if (widgetInputNames && widgetInputNames.length) {
      const n = alignNames(wv, widgetInputNames);
      if (n) return n;
    }
    for (const variant of BUILTIN[type] ?? []) if (variant.length === wv.length && fits(variant, wv)) return variant;
    return undefined;
  }
}

function fits(names: WidgetNames, wv: readonly Value[]): boolean {
  if (names.length !== wv.length) return false;
  for (let i = 0; i < names.length; i++) {
    if (names[i] === CONTROL && !(typeof wv[i] === 'string' && CONTROL_VALUES.has(wv[i] as string))) return false;
  }
  return true;
}

function isApiLink(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number') && typeof v[1] === 'number';
}

export function unwrapApiValue(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && '__value__' in (v as object)) return (v as { __value__: unknown }).__value__;
  return v;
}

function alignWithApi(wv: readonly Value[], api: Record<string, unknown>): string[] | undefined {
  const keys = Object.keys(api);
  const names: string[] = [];
  let j = 0;
  for (let i = 0; i < wv.length; i++) {
    const v = wv[i];
    if (j < keys.length) {
      const a = unwrapApiValue(api[keys[j]!]);
      if (isApiLink(a) || valuesEqual(v as Value, a as Value)) {
        names.push(keys[j]!);
        j++;
        continue;
      }
    }
    if (isControlValue(v, wv[i - 1])) {
      names.push(CONTROL);
      continue;
    }
    return undefined;
  }

  for (; j < keys.length; j++) if (!isApiLink(api[keys[j]!])) return undefined;
  return names;
}

function alignNames(wv: readonly Value[], widgetNames: string[]): string[] | undefined {
  const names: string[] = [];
  let j = 0;
  for (let i = 0; i < wv.length; i++) {
    if (i > 0 && isControlValue(wv[i], wv[i - 1]) && wv.length - i > widgetNames.length - j) {
      names.push(CONTROL);
      continue;
    }
    if (j >= widgetNames.length) return undefined;
    names.push(widgetNames[j++]!);
  }
  return j === widgetNames.length ? names : undefined;
}
