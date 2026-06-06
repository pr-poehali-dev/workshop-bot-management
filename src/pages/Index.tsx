import { useState, useEffect, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  fetchWorkers, createWorker, deleteWorker,
  fetchOrders, createOrder, updateOrderStatus, deleteOrder,
  fetchParts, createPart, adjustPartStock, deletePart,
  type Worker, type Order, type Part,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus = "new" | "progress" | "done";
type Tab = "dashboard" | "orders" | "parts" | "workers" | "stats";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OrderStatus, string> = { new: "Новый", progress: "В работе", done: "Готов" };
const STATUS_CLASSES: Record<OrderStatus, string> = { new: "status-new", progress: "status-progress", done: "status-done" };
const STATUS_ICONS: Record<OrderStatus, string> = { new: "Clock", progress: "Wrench", done: "CheckCircle2" };
const STATUS_NEXT: Record<OrderStatus, OrderStatus> = { new: "progress", progress: "done", done: "new" };

function fmt(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accentColor }: {
  label: string; value: string; sub?: string; icon: string; accentColor?: string;
}) {
  return (
    <div className="stat-card animate-fade-in">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</span>
        <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--accent))" }}>
          <Icon name={icon} size={16} style={{ color: accentColor || "hsl(var(--primary))" }} />
        </div>
      </div>
      <div className="font-mono text-2xl font-semibold" style={{ color: accentColor || "hsl(var(--foreground))" }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{sub}</div>}
    </div>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 rounded animate-pulse" style={{ background: "hsl(var(--muted))", width: j === 0 ? "70%" : "50%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function Index() {
  const [tab, setTab] = useState<Tab>("dashboard");

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [parts, setParts] = useState<Part[]>([]);

  const [loadingWorkers, setLoadingWorkers] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingParts, setLoadingParts] = useState(true);

  const [addOrderOpen, setAddOrderOpen] = useState(false);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [addWorkerOpen, setAddWorkerOpen] = useState(false);

  const [newOrder, setNewOrder] = useState({ title: "", workerId: "", amount: "", description: "" });
  const [newPart, setNewPart] = useState({ name: "", quantity: "", unit: "шт", minStock: "" });
  const [newWorker, setNewWorker] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadWorkers = useCallback(async () => {
    setLoadingWorkers(true);
    try { setWorkers(await fetchWorkers()); } finally { setLoadingWorkers(false); }
  }, []);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    try { setOrders(await fetchOrders()); } finally { setLoadingOrders(false); }
  }, []);

  const loadParts = useCallback(async () => {
    setLoadingParts(true);
    try { setParts(await fetchParts()); } finally { setLoadingParts(false); }
  }, []);

  useEffect(() => {
    loadWorkers();
    loadOrders();
    loadParts();
  }, [loadWorkers, loadOrders, loadParts]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const doneOrders = orders.filter(o => o.status === "done");
  const totalRevenue = doneOrders.reduce((s, o) => s + o.amount, 0);
  const activeOrders = orders.filter(o => o.status !== "done").length;
  const lowStock = parts.filter(p => p.quantity <= p.minStock).length;

  const filteredOrders = orders.filter(o => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (dateFrom && o.date < dateFrom) return false;
    if (dateTo && o.date > dateTo) return false;
    return true;
  });

  const workerStats = (workerId: number) => {
    const wo = orders.filter(o => o.workerId === workerId);
    const revenue = wo.filter(o => o.status === "done").reduce((s, o) => s + o.amount, 0);
    return { revenue, earnings: Math.round(revenue * 0.33), total: wo.length, done: wo.filter(o => o.status === "done").length, active: wo.filter(o => o.status !== "done").length };
  };

  // ── Actions ───────────────────────────────────────────────────────────────

  const submitOrder = async () => {
    if (!newOrder.title || !newOrder.workerId || !newOrder.amount) return;
    setSaving(true);
    try {
      await createOrder({ title: newOrder.title, workerId: Number(newOrder.workerId), amount: Number(newOrder.amount), description: newOrder.description, date: todayStr() });
      await loadOrders();
      setNewOrder({ title: "", workerId: "", amount: "", description: "" });
      setAddOrderOpen(false);
    } finally { setSaving(false); }
  };

  const submitPart = async () => {
    if (!newPart.name || !newPart.quantity) return;
    setSaving(true);
    try {
      await createPart({ name: newPart.name, quantity: Number(newPart.quantity), unit: newPart.unit, minStock: Number(newPart.minStock) || 5 });
      await loadParts();
      setNewPart({ name: "", quantity: "", unit: "шт", minStock: "" });
      setAddPartOpen(false);
    } finally { setSaving(false); }
  };

  const submitWorker = async () => {
    if (!newWorker.name) return;
    setSaving(true);
    try {
      await createWorker(newWorker.name, newWorker.phone);
      await loadWorkers();
      setNewWorker({ name: "", phone: "" });
      setAddWorkerOpen(false);
    } finally { setSaving(false); }
  };

  const handleCycleStatus = async (order: Order) => {
    const nextStatus = STATUS_NEXT[order.status];
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: nextStatus } : o));
    await updateOrderStatus(order.id, nextStatus);
  };

  const handleDeleteOrder = async (id: number) => {
    setOrders(prev => prev.filter(o => o.id !== id));
    await deleteOrder(id);
  };

  const handleDeletePart = async (id: number) => {
    setParts(prev => prev.filter(p => p.id !== id));
    await deletePart(id);
  };

  const handleDeleteWorker = async (id: number) => {
    setWorkers(prev => prev.filter(w => w.id !== id));
    await deleteWorker(id);
  };

  const handleAdjustStock = async (id: number, delta: number) => {
    setParts(prev => prev.map(p => p.id === id ? { ...p, quantity: Math.max(0, p.quantity + delta) } : p));
    const result = await adjustPartStock(id, delta);
    setParts(prev => prev.map(p => p.id === id ? { ...p, quantity: result.quantity } : p));
  };

  // ── Nav ───────────────────────────────────────────────────────────────────

  const navItems = [
    { id: "dashboard", label: "Дашборд", icon: "LayoutDashboard" },
    { id: "orders", label: "Заказы", icon: "ClipboardList", badge: activeOrders || undefined, badgeRed: false },
    { id: "parts", label: "Запчасти", icon: "Package", badge: lowStock > 0 ? lowStock : undefined, badgeRed: true },
    { id: "workers", label: "Рабочие", icon: "Users" },
    { id: "stats", label: "Статистика", icon: "BarChart3" },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "hsl(var(--background))" }}>

      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "hsl(var(--sidebar-background))", borderColor: "hsl(var(--sidebar-border))" }}>
        <div className="px-4 py-4 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--primary))" }}>
              <Icon name="Wrench" size={16} style={{ color: "hsl(var(--primary-foreground))" }} />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight" style={{ color: "hsl(var(--foreground))" }}>МастерБот</div>
              <div className="text-xs leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>управление</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
          {navItems.map(item => (
            <div key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id as Tab)}>
              <Icon name={item.icon} size={16} />
              <span className="flex-1 text-sm">{item.label}</span>
              {item.badge !== undefined && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{
                  background: item.badgeRed ? "hsl(var(--destructive) / 0.2)" : "hsl(var(--primary) / 0.15)",
                  color: item.badgeRed ? "hsl(var(--destructive))" : "hsl(var(--primary))",
                }}>{item.badge}</span>
              )}
            </div>
          ))}
        </nav>

        <div className="px-4 py-3 border-t" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <div className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
            Выручка: <span style={{ color: "hsl(var(--primary))" }}>{fmt(totalRevenue)}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>
              {navItems.find(n => n.id === tab)?.label}
            </h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              {tab === "dashboard" && "Обзор всей активности мастерской"}
              {tab === "orders" && `${orders.length} заказов · ${activeOrders} активных`}
              {tab === "parts" && `${parts.length} позиций · ${lowStock} с низким остатком`}
              {tab === "workers" && `${workers.length} рабочих`}
              {tab === "stats" && "Аналитика и расчёт заработка"}
            </p>
          </div>
          <div className="flex gap-2">
            {tab === "orders" && <Button size="sm" onClick={() => setAddOrderOpen(true)} style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}><Icon name="Plus" size={14} />Новый заказ</Button>}
            {tab === "parts" && <Button size="sm" onClick={() => setAddPartOpen(true)} style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}><Icon name="Plus" size={14} />Добавить</Button>}
            {tab === "workers" && <Button size="sm" onClick={() => setAddWorkerOpen(true)} style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}><Icon name="Plus" size={14} />Добавить рабочего</Button>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">

          {/* ══ DASHBOARD ══ */}
          {tab === "dashboard" && (
            <div className="animate-fade-in space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Выручка (готово)" value={fmt(totalRevenue)} sub={`${doneOrders.length} заказов`} icon="TrendingUp" accentColor="hsl(142 71% 45%)" />
                <StatCard label="Всего заказов" value={String(orders.length)} sub={`${activeOrders} активных`} icon="ClipboardList" />
                <StatCard label="Мало на складе" value={String(lowStock)} sub="позиций < минимума" icon="AlertTriangle" accentColor={lowStock > 0 ? "hsl(38 92% 50%)" : undefined} />
                <StatCard label="Рабочих" value={String(workers.filter(w => w.active).length)} sub="активных" icon="Users" />
              </div>

              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <span className="text-sm font-semibold">Последние заказы</span>
                  <button className="text-xs" style={{ color: "hsl(var(--primary))" }} onClick={() => setTab("orders")}>Все заказы →</button>
                </div>
                {loadingOrders ? (
                  <div className="px-4 py-8 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <div className="inline-block w-4 h-4 rounded-full border-2 border-t-transparent animate-spin mr-2" style={{ borderColor: "hsl(var(--primary))", borderTopColor: "transparent" }} />
                    Загрузка...
                  </div>
                ) : orders.slice(0, 5).map(order => (
                  <div key={order.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0" style={{ borderColor: "hsl(var(--border))" }}>
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${STATUS_CLASSES[order.status]}`}>{STATUS_LABELS[order.status]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{order.title}</div>
                      <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{order.workerName} · {order.date}</div>
                    </div>
                    <div className="font-mono text-sm font-semibold" style={{ color: order.status === "done" ? "hsl(142 71% 45%)" : "hsl(var(--muted-foreground))" }}>{fmt(order.amount)}</div>
                  </div>
                ))}
                {!loadingOrders && orders.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Заказов пока нет</div>
                )}
              </div>

              {lowStock > 0 && (
                <div className="rounded-lg border px-4 py-3 flex items-center gap-3" style={{ borderColor: "hsl(38 92% 50% / 0.3)", background: "hsl(38 92% 50% / 0.06)" }}>
                  <Icon name="AlertTriangle" size={16} style={{ color: "hsl(38 92% 50%)" }} />
                  <span className="text-sm"><span style={{ color: "hsl(38 92% 50%)" }} className="font-semibold">{lowStock} позиций</span><span style={{ color: "hsl(var(--muted-foreground))" }}> с низким остатком. Нужно пополнить склад.</span></span>
                  <button className="ml-auto text-xs" style={{ color: "hsl(38 92% 50%)" }} onClick={() => setTab("parts")}>Перейти →</button>
                </div>
              )}
            </div>
          )}

          {/* ══ ORDERS ══ */}
          {tab === "orders" && (
            <div className="animate-fade-in space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex gap-1.5">
                  {(["all", "new", "progress", "done"] as const).map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                      className="text-xs px-3 py-1.5 rounded-md border font-medium transition-all"
                      style={{
                        background: statusFilter === s ? "hsl(var(--primary) / 0.15)" : "transparent",
                        borderColor: statusFilter === s ? "hsl(var(--primary) / 0.4)" : "hsl(var(--border))",
                        color: statusFilter === s ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                      }}>
                      {s === "all" ? "Все" : STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 ml-auto items-center">
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="text-xs rounded-md border px-2 py-1.5 font-mono"
                    style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="text-xs rounded-md border px-2 py-1.5 font-mono"
                    style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                  {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>✕</button>}
                </div>
              </div>

              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))" }}>
                      {["Заказ", "Рабочий", "Статус", "Сумма", "Дата", ""].map((h, i) => (
                        <th key={i} className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider ${i === 3 ? "text-right" : "text-left"}`} style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingOrders ? <SkeletonRows cols={6} /> : filteredOrders.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Заказы не найдены</td></tr>
                    ) : filteredOrders.map(order => (
                      <tr key={order.id} className="border-b last:border-b-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: "hsl(var(--border))" }}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{order.title}</div>
                          {order.description && <div className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{order.description}</div>}
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{order.workerName || "—"}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleCycleStatus(order)}
                            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border font-medium transition-all hover:opacity-80 ${STATUS_CLASSES[order.status]}`}
                            title="Нажмите для смены статуса">
                            <Icon name={STATUS_ICONS[order.status]} size={11} />{STATUS_LABELS[order.status]}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: order.status === "done" ? "hsl(142 71% 45%)" : "hsl(var(--foreground))" }}>{fmt(order.amount)}</td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{order.date}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleDeleteOrder(order.id)} className="opacity-40 hover:opacity-100 transition-opacity">
                            <Icon name="Trash2" size={14} style={{ color: "hsl(var(--destructive))" }} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loadingOrders && filteredOrders.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t text-xs font-mono" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                    <span>{filteredOrders.length} заказов</span>
                    <span>Готовых: <span style={{ color: "hsl(142 71% 45%)" }} className="font-semibold">{fmt(filteredOrders.filter(o => o.status === "done").reduce((s, o) => s + o.amount, 0))}</span></span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ PARTS ══ */}
          {tab === "parts" && (
            <div className="animate-fade-in">
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))" }}>
                      {["Запчасть", "Остаток", "Минимум", "Управление", ""].map((h, i) => (
                        <th key={i} className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider ${i === 0 ? "text-left" : "text-center"}`} style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingParts ? <SkeletonRows cols={5} /> : parts.map(part => {
                      const low = part.quantity <= part.minStock;
                      return (
                        <tr key={part.id} className="border-b last:border-b-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: "hsl(var(--border))" }}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {low && <Icon name="AlertTriangle" size={13} style={{ color: "hsl(38 92% 50%)" }} />}
                              <span style={{ color: low ? "hsl(38 92% 50%)" : "hsl(var(--foreground))" }} className={low ? "font-medium" : ""}>{part.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center font-mono font-semibold" style={{ color: low ? "hsl(38 92% 50%)" : "hsl(var(--foreground))" }}>{part.quantity} {part.unit}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{part.minStock} {part.unit}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => handleAdjustStock(part.id, -1)} className="w-7 h-7 rounded border flex items-center justify-center text-xs font-bold transition-all hover:opacity-80" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))" }}>−</button>
                              <button onClick={() => handleAdjustStock(part.id, 1)} className="w-7 h-7 rounded border flex items-center justify-center text-xs font-bold transition-all hover:opacity-80" style={{ borderColor: "hsl(var(--primary) / 0.4)", color: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.1)" }}>+</button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleDeletePart(part.id)} className="opacity-40 hover:opacity-100 transition-opacity">
                              <Icon name="Trash2" size={14} style={{ color: "hsl(var(--destructive))" }} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-3 border-t text-xs font-mono" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  {parts.length} позиций · {lowStock > 0 ? <span style={{ color: "hsl(38 92% 50%)" }}>{lowStock} мало на складе</span> : <span style={{ color: "hsl(142 71% 45%)" }}>склад в норме</span>}
                </div>
              </div>
            </div>
          )}

          {/* ══ WORKERS ══ */}
          {tab === "workers" && (
            <div className="animate-fade-in space-y-3">
              {loadingWorkers ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-lg border p-4 animate-pulse" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                    <div className="h-4 rounded w-1/3" style={{ background: "hsl(var(--muted))" }} />
                  </div>
                ))
              ) : workers.map(worker => {
                const s = workerStats(worker.id);
                return (
                  <div key={worker.id} className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                    <div className="flex items-center gap-4 px-4 py-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}>
                        {worker.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-sm">{worker.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{worker.phone || "Телефон не указан"}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold" style={{ color: "hsl(var(--primary))" }}>
                          {fmt(s.earnings)} <span className="text-xs font-normal opacity-60">(33%)</span>
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>выручка: {fmt(s.revenue)}</div>
                      </div>
                      <button onClick={() => handleDeleteWorker(worker.id)} className="opacity-30 hover:opacity-80 transition-opacity ml-2">
                        <Icon name="Trash2" size={14} style={{ color: "hsl(var(--destructive))" }} />
                      </button>
                    </div>
                    <div className="flex items-center gap-4 px-4 py-2.5 border-t" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                      <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Заказов: <span style={{ color: "hsl(var(--foreground))" }} className="font-medium">{s.total}</span></span>
                      <span className="text-xs px-2 py-0.5 rounded border status-done">✓ {s.done} выполнено</span>
                      {s.active > 0 && <span className="text-xs px-2 py-0.5 rounded border status-progress">⚙ {s.active} активных</span>}
                    </div>
                  </div>
                );
              })}
              {!loadingWorkers && workers.length === 0 && (
                <div className="text-center py-12 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Рабочих пока нет</div>
              )}
            </div>
          )}

          {/* ══ STATS ══ */}
          {tab === "stats" && (
            <div className="animate-fade-in space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard label="Общая выручка" value={fmt(totalRevenue)} sub="все готовые заказы" icon="TrendingUp" accentColor="hsl(142 71% 45%)" />
                <StatCard label="Ср. сумма заказа" value={doneOrders.length ? fmt(Math.round(totalRevenue / doneOrders.length)) : "—"} sub="готовые заказы" icon="Calculator" />
                <StatCard label="Всего заказов" value={String(orders.length)} sub={`${doneOrders.length} выполнено`} icon="ClipboardList" />
              </div>

              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <span className="text-sm font-semibold">Расчёт заработка рабочих (33%)</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))" }}>
                      {["Рабочий", "Заказов", "Выручка", "Заработок (33%)"].map((h, i) => (
                        <th key={i} className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wider ${i === 0 ? "text-left" : "text-right"}`} style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingWorkers ? <SkeletonRows cols={4} rows={3} /> : workers.map(worker => {
                      const s = workerStats(worker.id);
                      return (
                        <tr key={worker.id} className="border-b last:border-b-0 hover:bg-white/[0.02]" style={{ borderColor: "hsl(var(--border))" }}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}>
                                {worker.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                              </div>
                              {worker.name}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{s.done}</td>
                          <td className="px-4 py-3 text-right font-mono font-medium">{fmt(s.revenue)}</td>
                          <td className="px-4 py-3 text-right font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{fmt(s.earnings)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "1px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.7)" }}>
                      <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Итого</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">{doneOrders.length}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: "hsl(142 71% 45%)" }}>{fmt(totalRevenue)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold" style={{ color: "hsl(var(--primary))" }}>{fmt(Math.round(totalRevenue * 0.33))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <span className="text-sm font-semibold">Распределение по статусам</span>
                </div>
                <div className="grid grid-cols-3 divide-x" style={{ borderColor: "hsl(var(--border))" }}>
                  {(["new", "progress", "done"] as OrderStatus[]).map(s => {
                    const count = orders.filter(o => o.status === s).length;
                    const revenue = orders.filter(o => o.status === s).reduce((sum, o) => sum + o.amount, 0);
                    return (
                      <div key={s} className="px-4 py-4 text-center">
                        <div className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border font-medium mb-3 ${STATUS_CLASSES[s]}`}>
                          <Icon name={STATUS_ICONS[s]} size={11} />{STATUS_LABELS[s]}
                        </div>
                        <div className="font-mono text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>{count}</div>
                        <div className="text-xs mt-1 font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{fmt(revenue)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ══ MODAL: Add Order ══ */}
      <Dialog open={addOrderOpen} onOpenChange={setAddOrderOpen}>
        <DialogContent style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <DialogHeader><DialogTitle>Новый заказ</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Название заказа *</label>
              <Input placeholder="Например: Ремонт двигателя Toyota Camry" value={newOrder.title} onChange={e => setNewOrder(p => ({ ...p, title: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Рабочий *</label>
              <Select value={newOrder.workerId} onValueChange={v => setNewOrder(p => ({ ...p, workerId: v }))}>
                <SelectTrigger style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }}><SelectValue placeholder="Выберите рабочего" /></SelectTrigger>
                <SelectContent style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  {workers.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Стоимость (₽) *</label>
              <Input placeholder="0" type="number" value={newOrder.amount} onChange={e => setNewOrder(p => ({ ...p, amount: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Описание</label>
              <Input placeholder="Краткое описание работ" value={newOrder.description} onChange={e => setNewOrder(p => ({ ...p, description: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
            </div>
            <Button onClick={submitOrder} disabled={saving} className="w-full mt-2" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              {saving ? "Сохраняю..." : "Создать заказ"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══ MODAL: Add Part ══ */}
      <Dialog open={addPartOpen} onOpenChange={setAddPartOpen}>
        <DialogContent style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <DialogHeader><DialogTitle>Добавить запчасть</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Название *</label>
              <Input placeholder="Например: Тормозные колодки передние" value={newPart.name} onChange={e => setNewPart(p => ({ ...p, name: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Количество *</label>
                <Input placeholder="0" type="number" value={newPart.quantity} onChange={e => setNewPart(p => ({ ...p, quantity: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Единица</label>
                <Input placeholder="шт" value={newPart.unit} onChange={e => setNewPart(p => ({ ...p, unit: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Мин. остаток (предупреждение)</label>
              <Input placeholder="5" type="number" value={newPart.minStock} onChange={e => setNewPart(p => ({ ...p, minStock: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
            </div>
            <Button onClick={submitPart} disabled={saving} className="w-full mt-2" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              {saving ? "Сохраняю..." : "Добавить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ══ MODAL: Add Worker ══ */}
      <Dialog open={addWorkerOpen} onOpenChange={setAddWorkerOpen}>
        <DialogContent style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <DialogHeader><DialogTitle>Добавить рабочего</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Имя *</label>
              <Input placeholder="Фамилия Имя" value={newWorker.name} onChange={e => setNewWorker(p => ({ ...p, name: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "hsl(var(--muted-foreground))" }}>Телефон</label>
              <Input placeholder="+7 (999) 000-00-00" value={newWorker.phone} onChange={e => setNewWorker(p => ({ ...p, phone: e.target.value }))} style={{ background: "hsl(var(--input))", borderColor: "hsl(var(--border))" }} />
            </div>
            <Button onClick={submitWorker} disabled={saving} className="w-full mt-2" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
              {saving ? "Сохраняю..." : "Добавить рабочего"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
