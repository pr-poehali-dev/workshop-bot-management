import func2url from "../../backend/func2url.json";

const WORKERS_URL = func2url.workers;
const ORDERS_URL = func2url.orders;
const PARTS_URL = func2url.parts;

// ─── Workers ──────────────────────────────────────────────────────────────────

export interface Worker {
  id: number;
  name: string;
  phone: string;
  active: boolean;
}

export async function fetchWorkers(): Promise<Worker[]> {
  const res = await fetch(WORKERS_URL);
  const text = await res.text();
  const data = JSON.parse(text);
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  return parsed.workers ?? [];
}

export async function createWorker(name: string, phone: string): Promise<Worker> {
  const res = await fetch(WORKERS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, phone }),
  });
  const text = await res.text();
  const data = JSON.parse(text);
  return typeof data === "string" ? JSON.parse(data) : data;
}

export async function deleteWorker(id: number): Promise<void> {
  await fetch(`${WORKERS_URL}?id=${id}`, { method: "DELETE" });
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface Order {
  id: number;
  title: string;
  workerId: number;
  workerName: string;
  status: "new" | "progress" | "done";
  amount: number;
  description: string;
  date: string;
}

export async function fetchOrders(params?: { status?: string; date_from?: string; date_to?: string }): Promise<Order[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.date_from) q.set("date_from", params.date_from);
  if (params?.date_to) q.set("date_to", params.date_to);
  const url = q.toString() ? `${ORDERS_URL}?${q}` : ORDERS_URL;
  const res = await fetch(url);
  const text = await res.text();
  const data = JSON.parse(text);
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  return parsed.orders ?? [];
}

export async function createOrder(payload: { title: string; workerId: number; amount: number; description: string; date: string }): Promise<{ id: number }> {
  const res = await fetch(ORDERS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const data = JSON.parse(text);
  return typeof data === "string" ? JSON.parse(data) : data;
}

export async function updateOrderStatus(id: number, status: string): Promise<void> {
  await fetch(ORDERS_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
}

export async function deleteOrder(id: number): Promise<void> {
  await fetch(`${ORDERS_URL}?id=${id}`, { method: "DELETE" });
}

// ─── Parts ────────────────────────────────────────────────────────────────────

export interface Part {
  id: number;
  name: string;
  quantity: number;
  unit: string;
  minStock: number;
}

export async function fetchParts(): Promise<Part[]> {
  const res = await fetch(PARTS_URL);
  const text = await res.text();
  const data = JSON.parse(text);
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  return parsed.parts ?? [];
}

export async function createPart(payload: { name: string; quantity: number; unit: string; minStock: number }): Promise<{ id: number }> {
  const res = await fetch(PARTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const data = JSON.parse(text);
  return typeof data === "string" ? JSON.parse(data) : data;
}

export async function adjustPartStock(id: number, delta: number): Promise<{ quantity: number }> {
  const res = await fetch(PARTS_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, delta }),
  });
  const text = await res.text();
  const data = JSON.parse(text);
  return typeof data === "string" ? JSON.parse(data) : data;
}

export async function deletePart(id: number): Promise<void> {
  await fetch(`${PARTS_URL}?id=${id}`, { method: "DELETE" });
}