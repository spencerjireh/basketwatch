"use server";

import { apiBaseUrl } from "@/lib/env";

const opsToken = () => process.env.OPS_TOKEN ?? "";

async function opsGet(path: string): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${opsToken()}` },
    cache: "no-store",
  });
  return res.json();
}

async function opsPost(path: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opsToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return res.json();
}

export async function fetchPreviewPrompt(
  scraperId: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const data = (await opsGet(`/api/heal/${scraperId}/preview-prompt`)) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}

export async function fetchHealStatus(
  scraperId: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const data = (await opsGet(`/api/heal/${scraperId}/status`)) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}

export async function triggerHeal(
  scraperId: string,
  prompt?: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const body: Record<string, unknown> = {};
    if (prompt) body.prompt = prompt;
    const data = (await opsPost(`/api/heal/${scraperId}/trigger`, body)) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}

export async function approveHeal(
  scraperId: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const data = (await opsPost(`/api/heal/${scraperId}/approve`)) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}

export async function rejectHeal(
  scraperId: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const data = (await opsPost(`/api/heal/${scraperId}/reject`)) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}

export async function seedBaselines(): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const data = (await opsPost("/api/fleet/seed-baselines")) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}

export async function captureAllCode(): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const data = (await opsPost("/api/fleet/capture-code")) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}

export async function captureOneCode(
  scraperId: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const data = (await opsPost(`/api/fleet/capture-code/${scraperId}`)) as Record<string, unknown>;
    return { ok: !("error" in data), data };
  } catch (err) {
    return { ok: false, data: { error: String(err) } };
  }
}
