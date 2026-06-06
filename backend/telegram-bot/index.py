"""
Telegram-бот для управления мастерской.
Webhook: принимает обновления от Telegram и обрабатывает команды/кнопки.
Функционал: заказы, запчасти, рабочие, статистика, расчёт 33% заработка.
"""
import json
import os
import psycopg2
import urllib.request
import urllib.parse

SCHEMA = "t_p60693553_workshop_bot_managem"
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# ─── DB ───────────────────────────────────────────────────────────────────────

def db():
    return psycopg2.connect(os.environ["DATABASE_URL"])


# ─── Telegram API ─────────────────────────────────────────────────────────────

def tg(method, payload):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def send(chat_id, text, reply_markup=None, parse_mode="HTML"):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return tg("sendMessage", payload)


def edit(chat_id, message_id, text, reply_markup=None, parse_mode="HTML"):
    payload = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return tg("editMessageText", payload)


def answer_callback(callback_id, text=""):
    tg("answerCallbackQuery", {"callback_query_id": callback_id, "text": text})


# ─── Keyboards ────────────────────────────────────────────────────────────────

def kb_main():
    return {
        "inline_keyboard": [
            [{"text": "📋 Заказы", "callback_data": "orders"}, {"text": "🔧 Запчасти", "callback_data": "parts"}],
            [{"text": "👷 Рабочие", "callback_data": "workers"}, {"text": "📊 Статистика", "callback_data": "stats"}],
        ]
    }


def kb_back(to="main"):
    return {"inline_keyboard": [[{"text": "◀️ Назад", "callback_data": to}]]}


def kb_orders():
    return {
        "inline_keyboard": [
            [{"text": "➕ Новый заказ", "callback_data": "order_new"}],
            [{"text": "🕐 Новые", "callback_data": "orders_new"}, {"text": "⚙️ В работе", "callback_data": "orders_progress"}],
            [{"text": "✅ Готовые", "callback_data": "orders_done"}, {"text": "📋 Все", "callback_data": "orders_all"}],
            [{"text": "◀️ Меню", "callback_data": "main"}],
        ]
    }


def kb_parts():
    return {
        "inline_keyboard": [
            [{"text": "➕ Добавить запчасть", "callback_data": "part_new"}],
            [{"text": "📦 Список остатков", "callback_data": "parts_list"}],
            [{"text": "⚠️ Мало на складе", "callback_data": "parts_low"}],
            [{"text": "◀️ Меню", "callback_data": "main"}],
        ]
    }


def kb_workers():
    return {
        "inline_keyboard": [
            [{"text": "➕ Добавить рабочего", "callback_data": "worker_new"}],
            [{"text": "👷 Список рабочих", "callback_data": "workers_list"}],
            [{"text": "💰 Заработок рабочих", "callback_data": "workers_earnings"}],
            [{"text": "◀️ Меню", "callback_data": "main"}],
        ]
    }


def kb_order_actions(order_id, status):
    next_map = {"new": ("⚙️ В работу", "progress"), "progress": ("✅ Готов", "done"), "done": ("🔄 Снова новый", "new")}
    label, next_status = next_map.get(status, ("✅ Готов", "done"))
    return {
        "inline_keyboard": [
            [{"text": label, "callback_data": f"order_status_{order_id}_{next_status}"}],
            [{"text": "🔩 Запчасти заказа", "callback_data": f"order_parts_{order_id}"}],
            [{"text": "◀️ К заказам", "callback_data": "orders"}],
        ]
    }


# ─── DB helpers ───────────────────────────────────────────────────────────────

STATUS_RU = {"new": "🕐 Новый", "progress": "⚙️ В работе", "done": "✅ Готов"}


def fmt_money(n):
    return f"{int(n):,}".replace(",", " ") + " ₽"


def get_orders(conn, status=None):
    cur = conn.cursor()
    sql = f"""SELECT o.id, o.title, w.name, o.status, o.amount, o.date::text
              FROM {SCHEMA}.orders o LEFT JOIN {SCHEMA}.workers w ON w.id=o.worker_id
              WHERE 1=1"""
    args = []
    if status:
        sql += " AND o.status=%s"
        args.append(status)
    sql += " ORDER BY o.id DESC LIMIT 20"
    cur.execute(sql, args)
    rows = cur.fetchall()
    cur.close()
    return rows


def get_workers(conn):
    cur = conn.cursor()
    cur.execute(f"SELECT id, name, phone FROM {SCHEMA}.workers WHERE active=TRUE ORDER BY id")
    rows = cur.fetchall()
    cur.close()
    return rows


def get_parts(conn, low_only=False):
    cur = conn.cursor()
    if low_only:
        cur.execute(f"SELECT id, name, quantity, unit, min_stock FROM {SCHEMA}.parts WHERE quantity<=min_stock ORDER BY name")
    else:
        cur.execute(f"SELECT id, name, quantity, unit, min_stock FROM {SCHEMA}.parts ORDER BY name")
    rows = cur.fetchall()
    cur.close()
    return rows


def get_order_parts(conn, order_id):
    cur = conn.cursor()
    cur.execute(f"SELECT part_name, quantity, part_unit FROM {SCHEMA}.order_parts WHERE order_id=%s ORDER BY id", (order_id,))
    rows = cur.fetchall()
    cur.close()
    return rows


# ─── Session state (хранится в БД) ────────────────────────────────────────────

def get_state(conn, chat_id):
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT state, data FROM {SCHEMA}.bot_sessions WHERE chat_id=%s", (str(chat_id),))
        row = cur.fetchone()
        if row:
            return row[0], json.loads(row[1]) if row[1] else {}
        return None, {}
    except Exception:
        conn.rollback()
        return None, {}
    finally:
        cur.close()


def set_state(conn, chat_id, state, data=None):
    cur = conn.cursor()
    data_json = json.dumps(data or {})
    cur.execute(f"""
        INSERT INTO {SCHEMA}.bot_sessions (chat_id, state, data, updated_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (chat_id) DO UPDATE SET state=EXCLUDED.state, data=EXCLUDED.data, updated_at=NOW()
    """, (str(chat_id), state, data_json))
    conn.commit()
    cur.close()


def clear_state(conn, chat_id):
    set_state(conn, chat_id, None, {})


# ─── Handlers ─────────────────────────────────────────────────────────────────

def handle_main_menu(chat_id, message_id=None):
    text = (
        "🔧 <b>МастерБот</b>\n\n"
        "Управление мастерской. Выберите раздел:"
    )
    if message_id:
        edit(chat_id, message_id, text, kb_main())
    else:
        send(chat_id, text, kb_main())


def handle_orders_menu(chat_id, message_id=None):
    text = "📋 <b>Заказы</b>\n\nВыберите действие:"
    if message_id:
        edit(chat_id, message_id, text, kb_orders())
    else:
        send(chat_id, text, kb_orders())


def handle_orders_list(chat_id, message_id, status=None):
    conn = db()
    rows = get_orders(conn, status)
    conn.close()

    if not rows:
        text = "📋 Заказов не найдено."
    else:
        lines = []
        label = {"new": "Новые", "progress": "В работе", "done": "Готовые", None: "Все"}[status]
        lines.append(f"📋 <b>{label} заказы ({len(rows)})</b>\n")
        for r in rows:
            oid, title, worker, st, amount, date = r
            lines.append(
                f"<b>#{oid}</b> {title}\n"
                f"  👷 {worker or '—'}  {STATUS_RU.get(st, st)}  {fmt_money(amount)}\n"
                f"  📅 {date}"
            )
        text = "\n\n".join(lines)

    kb = {
        "inline_keyboard": [
            [{"text": f"📂 #{r[0]} подробнее", "callback_data": f"order_{r[0]}"} for r in rows[:1]],
            *[[{"text": f"#{r[0]} {r[1][:25]}", "callback_data": f"order_{r[0]}"}] for r in rows],
            [{"text": "◀️ К заказам", "callback_data": "orders"}],
        ] if rows else [[{"text": "◀️ К заказам", "callback_data": "orders"}]]
    }
    # Упрощённая клавиатура
    if rows:
        inline = [[{"text": f"#{r[0]} {r[1][:30]}", "callback_data": f"order_{r[0]}"}] for r in rows]
        inline.append([{"text": "◀️ К заказам", "callback_data": "orders"}])
        kb = {"inline_keyboard": inline}

    edit(chat_id, message_id, text, kb)


def handle_order_detail(chat_id, message_id, order_id):
    conn = db()
    cur = conn.cursor()
    cur.execute(
        f"""SELECT o.id, o.title, w.name, o.status, o.amount, o.description, o.date::text
            FROM {SCHEMA}.orders o LEFT JOIN {SCHEMA}.workers w ON w.id=o.worker_id
            WHERE o.id=%s""",
        (order_id,)
    )
    row = cur.fetchone()
    cur.close()
    order_parts = get_order_parts(conn, order_id)
    conn.close()

    if not row:
        edit(chat_id, message_id, "❌ Заказ не найден.", kb_back("orders"))
        return

    oid, title, worker, status, amount, desc, date = row
    parts_text = ""
    if order_parts:
        parts_lines = "\n".join(f"  • {p[0]}: {p[1]} {p[2]}" for p in order_parts)
        parts_text = f"\n\n🔩 <b>Запчасти:</b>\n{parts_lines}"

    text = (
        f"📋 <b>Заказ #{oid}</b>\n\n"
        f"<b>{title}</b>\n"
        f"👷 Рабочий: {worker or '—'}\n"
        f"📌 Статус: {STATUS_RU.get(status, status)}\n"
        f"💰 Сумма: {fmt_money(amount)}\n"
        f"📅 Дата: {date}"
        + (f"\n📝 {desc}" if desc else "")
        + parts_text
    )
    edit(chat_id, message_id, text, kb_order_actions(oid, status))


def handle_stats(chat_id, message_id):
    conn = db()
    cur = conn.cursor()

    # Общая статистика
    cur.execute(f"""
        SELECT COUNT(*), SUM(CASE WHEN status='done' THEN amount ELSE 0 END),
               COUNT(CASE WHEN status='new' THEN 1 END),
               COUNT(CASE WHEN status='progress' THEN 1 END),
               COUNT(CASE WHEN status='done' THEN 1 END)
        FROM {SCHEMA}.orders
    """)
    total, revenue, cnt_new, cnt_prog, cnt_done = cur.fetchone()
    revenue = float(revenue or 0)

    # По рабочим
    cur.execute(f"""
        SELECT w.name,
               COUNT(o.id) as cnt,
               COALESCE(SUM(CASE WHEN o.status='done' THEN o.amount ELSE 0 END), 0) as rev
        FROM {SCHEMA}.workers w
        LEFT JOIN {SCHEMA}.orders o ON o.worker_id=w.id
        WHERE w.active=TRUE
        GROUP BY w.id, w.name
        ORDER BY rev DESC
    """)
    workers_rows = cur.fetchall()
    cur.close()
    conn.close()

    worker_lines = []
    for name, cnt, rev in workers_rows:
        rev = float(rev)
        earnings = int(rev * 0.33)
        worker_lines.append(
            f"  👷 <b>{name}</b>\n"
            f"    Заказов: {cnt}  |  Выручка: {fmt_money(rev)}\n"
            f"    💰 Заработок (33%): <b>{fmt_money(earnings)}</b>"
        )

    text = (
        f"📊 <b>Статистика мастерской</b>\n\n"
        f"📋 Всего заказов: <b>{total}</b>\n"
        f"  🕐 Новых: {cnt_new}  ⚙️ В работе: {cnt_prog}  ✅ Готово: {cnt_done}\n\n"
        f"💵 Общая выручка: <b>{fmt_money(revenue)}</b>\n"
        f"💸 Фонд рабочих (33%): <b>{fmt_money(int(revenue * 0.33))}</b>\n\n"
        f"<b>По рабочим:</b>\n" + "\n\n".join(worker_lines)
    )
    edit(chat_id, message_id, text, kb_back("main"))


def handle_parts_list(chat_id, message_id, low_only=False):
    conn = db()
    rows = get_parts(conn, low_only)
    conn.close()

    title = "⚠️ Мало на складе" if low_only else "📦 Склад запчастей"
    if not rows:
        text = f"{title}\n\nПозиций не найдено."
    else:
        lines = [f"{title} ({len(rows)} позиций)\n"]
        for r in rows:
            pid, name, qty, unit, min_stock = r
            low = float(qty) <= float(min_stock)
            icon = "⚠️" if low else "✅"
            lines.append(f"{icon} {name}\n   Остаток: <b>{qty} {unit}</b>  (мин: {min_stock})")
        text = "\n\n".join(lines)

    edit(chat_id, message_id, text, kb_back("parts"))


def handle_workers_list(chat_id, message_id):
    conn = db()
    rows = get_workers(conn)
    conn.close()

    if not rows:
        text = "👷 Рабочих нет."
    else:
        lines = [f"👷 <b>Рабочие ({len(rows)})</b>\n"]
        for wid, name, phone in rows:
            lines.append(f"• <b>{name}</b>\n  📞 {phone or 'телефон не указан'}")
        text = "\n\n".join(lines)

    edit(chat_id, message_id, text, kb_back("workers"))


def handle_workers_earnings(chat_id, message_id):
    conn = db()
    cur = conn.cursor()
    cur.execute(f"""
        SELECT w.name,
               COUNT(CASE WHEN o.status='done' THEN 1 END) as done_cnt,
               COALESCE(SUM(CASE WHEN o.status='done' THEN o.amount ELSE 0 END), 0) as rev,
               COUNT(CASE WHEN o.status!='done' THEN 1 END) as active_cnt
        FROM {SCHEMA}.workers w
        LEFT JOIN {SCHEMA}.orders o ON o.worker_id=w.id
        WHERE w.active=TRUE
        GROUP BY w.id, w.name
        ORDER BY rev DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    lines = ["💰 <b>Заработок рабочих (33% от выручки)</b>\n"]
    total_earnings = 0
    for name, done_cnt, rev, active_cnt in rows:
        rev = float(rev)
        earnings = int(rev * 0.33)
        total_earnings += earnings
        lines.append(
            f"👷 <b>{name}</b>\n"
            f"  Выполнено: {done_cnt} зак.  |  В работе: {active_cnt}\n"
            f"  Выручка: {fmt_money(rev)}\n"
            f"  <b>К выплате: {fmt_money(earnings)}</b>"
        )
    lines.append(f"\n💵 Итого к выплате: <b>{fmt_money(total_earnings)}</b>")
    edit(chat_id, message_id, "\n\n".join(lines), kb_back("workers"))


# ─── State machine для ввода ──────────────────────────────────────────────────

def handle_text_input(chat_id, text, conn):
    state, data = get_state(conn, chat_id)

    if state == "await_order_title":
        set_state(conn, chat_id, "await_order_worker", {"title": text})
        workers = get_workers(conn)
        if not workers:
            send(chat_id, "❌ Нет рабочих. Сначала добавьте рабочего.")
            clear_state(conn, chat_id)
            return
        kb = {"inline_keyboard": [[{"text": w[1], "callback_data": f"pick_worker_{w[0]}"}] for w in workers]}
        send(chat_id, f"📋 Заказ: <b>{text}</b>\n\nВыберите рабочего:", kb)

    elif state == "await_order_amount":
        try:
            amount = float(text.replace(" ", "").replace(",", "."))
        except ValueError:
            send(chat_id, "❌ Введите число. Например: 5000")
            return
        title = data.get("title", "")
        worker_id = data.get("worker_id")
        desc = data.get("description", "")
        cur = conn.cursor()
        cur.execute(
            f"INSERT INTO {SCHEMA}.orders (title, worker_id, amount, description, date) VALUES (%s,%s,%s,%s,CURRENT_DATE) RETURNING id",
            (title, worker_id, amount, desc or None)
        )
        new_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        clear_state(conn, chat_id)
        send(chat_id,
             f"✅ <b>Заказ #{new_id} создан!</b>\n\n"
             f"📋 {title}\n💰 {fmt_money(amount)}\n📌 Статус: 🕐 Новый",
             kb_main())

    elif state == "await_order_desc":
        worker_id = data.get("worker_id")
        title = data.get("title", "")
        set_state(conn, chat_id, "await_order_amount", {"title": title, "worker_id": worker_id, "description": text})
        send(chat_id, f"💰 Введите стоимость заказа (₽):")

    elif state == "await_part_name":
        set_state(conn, chat_id, "await_part_qty", {"name": text})
        send(chat_id, f"📦 Запчасть: <b>{text}</b>\n\nВведите количество (число):")

    elif state == "await_part_qty":
        try:
            qty = float(text.replace(",", "."))
        except ValueError:
            send(chat_id, "❌ Введите число. Например: 10")
            return
        set_state(conn, chat_id, "await_part_unit", {**data, "quantity": qty})
        send(chat_id, "📏 Введите единицу измерения (шт, л, компл., м и т.д.):")

    elif state == "await_part_unit":
        part_data = {**data, "unit": text}
        set_state(conn, chat_id, "await_part_minstock", part_data)
        send(chat_id, "⚠️ Введите минимальный остаток для предупреждения (число):")

    elif state == "await_part_minstock":
        try:
            min_stock = float(text.replace(",", "."))
        except ValueError:
            min_stock = 5.0
        cur = conn.cursor()
        cur.execute(
            f"INSERT INTO {SCHEMA}.parts (name, quantity, unit, min_stock) VALUES (%s,%s,%s,%s) RETURNING id",
            (data["name"], data["quantity"], data.get("unit", "шт"), min_stock)
        )
        conn.commit()
        cur.close()
        clear_state(conn, chat_id)
        send(chat_id,
             f"✅ <b>Запчасть добавлена!</b>\n\n"
             f"📦 {data['name']}\n"
             f"Кол-во: {data['quantity']} {data.get('unit', 'шт')}\n"
             f"Мин. остаток: {min_stock}",
             kb_main())

    elif state == "await_worker_name":
        set_state(conn, chat_id, "await_worker_phone", {"name": text})
        send(chat_id, f"👷 Рабочий: <b>{text}</b>\n\nВведите номер телефона (или напишите «-» чтобы пропустить):")

    elif state == "await_worker_phone":
        phone = None if text.strip() == "-" else text.strip()
        cur = conn.cursor()
        cur.execute(
            f"INSERT INTO {SCHEMA}.workers (name, phone) VALUES (%s,%s) RETURNING id",
            (data["name"], phone)
        )
        conn.commit()
        cur.close()
        clear_state(conn, chat_id)
        send(chat_id,
             f"✅ <b>Рабочий добавлен!</b>\n\n"
             f"👷 {data['name']}\n"
             f"📞 {phone or 'не указан'}",
             kb_main())

    else:
        handle_main_menu(chat_id)


# ─── Callback dispatcher ──────────────────────────────────────────────────────

def handle_callback(chat_id, message_id, callback_id, data, conn):
    answer_callback(callback_id)

    if data == "main":
        clear_state(conn, chat_id)
        handle_main_menu(chat_id, message_id)

    elif data == "orders":
        handle_orders_menu(chat_id, message_id)

    elif data in ("orders_all", "orders_new", "orders_progress", "orders_done"):
        status_map = {"orders_all": None, "orders_new": "new", "orders_progress": "progress", "orders_done": "done"}
        handle_orders_list(chat_id, message_id, status_map[data])

    elif data.startswith("order_") and data[6:].isdigit():
        handle_order_detail(chat_id, message_id, int(data[6:]))

    elif data.startswith("order_status_"):
        parts = data.split("_")
        order_id, new_status = int(parts[2]), parts[3]
        cur = conn.cursor()
        cur.execute(f"UPDATE {SCHEMA}.orders SET status=%s WHERE id=%s", (new_status, order_id))
        conn.commit()
        cur.close()
        handle_order_detail(chat_id, message_id, order_id)

    elif data.startswith("order_parts_"):
        order_id = int(data.split("_")[2])
        op_rows = get_order_parts(conn, order_id)
        if not op_rows:
            text = f"🔩 Запчасти заказа <b>#{order_id}</b>\n\nЗапчасти не добавлены.\nДобавить запчасти можно в веб-панели."
        else:
            lines = [f"🔩 <b>Запчасти заказа #{order_id}:</b>\n"]
            for name, qty, unit in op_rows:
                lines.append(f"  • {name}: <b>{qty} {unit}</b>")
            text = "\n".join(lines)
        edit(chat_id, message_id, text, kb_back("orders"))

    elif data == "order_new":
        clear_state(conn, chat_id)
        set_state(conn, chat_id, "await_order_title")
        edit(chat_id, message_id, "📋 <b>Новый заказ</b>\n\nВведите название заказа:")

    elif data.startswith("pick_worker_"):
        worker_id = int(data.split("_")[2])
        state, sdata = get_state(conn, chat_id)
        set_state(conn, chat_id, "await_order_desc", {**sdata, "worker_id": worker_id})
        send(chat_id, "📝 Введите описание работ (или напишите «-» чтобы пропустить):")

    elif data == "parts":
        edit(chat_id, message_id, "🔧 <b>Запчасти</b>\n\nВыберите действие:", kb_parts())

    elif data == "parts_list":
        handle_parts_list(chat_id, message_id, low_only=False)

    elif data == "parts_low":
        handle_parts_list(chat_id, message_id, low_only=True)

    elif data == "part_new":
        clear_state(conn, chat_id)
        set_state(conn, chat_id, "await_part_name")
        edit(chat_id, message_id, "📦 <b>Новая запчасть</b>\n\nВведите название запчасти:")

    elif data == "workers":
        edit(chat_id, message_id, "👷 <b>Рабочие</b>\n\nВыберите действие:", kb_workers())

    elif data == "workers_list":
        handle_workers_list(chat_id, message_id)

    elif data == "workers_earnings":
        handle_workers_earnings(chat_id, message_id)

    elif data == "worker_new":
        clear_state(conn, chat_id)
        set_state(conn, chat_id, "await_worker_name")
        edit(chat_id, message_id, "👷 <b>Новый рабочий</b>\n\nВведите имя и фамилию:")

    elif data == "stats":
        handle_stats(chat_id, message_id)


# ─── Webhook setup ────────────────────────────────────────────────────────────

def setup_webhook(webhook_url):
    result = tg("setWebhook", {"url": webhook_url, "allowed_updates": ["message", "callback_query"]})
    return result


# ─── Main handler ─────────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    # GET ?setup=1 — установить webhook
    if event.get("httpMethod") == "GET":
        params = event.get("queryStringParameters") or {}
        if params.get("setup"):
            func_url = "https://functions.poehali.dev/4d265f2e-0c37-4556-b659-c6e41cbf89d2"
            result = setup_webhook(func_url)
            return {"statusCode": 200, "headers": CORS, "body": json.dumps(result)}
        return {"statusCode": 200, "headers": CORS, "body": json.dumps({"status": "bot running"})}

    # POST — обновление от Telegram
    body = event.get("body", "")
    if not body:
        return {"statusCode": 200, "headers": CORS, "body": "ok"}

    try:
        update = json.loads(body) if isinstance(body, str) else body
    except Exception:
        return {"statusCode": 200, "headers": CORS, "body": "ok"}

    conn = db()
    try:
        # Callback query
        if "callback_query" in update:
            cq = update["callback_query"]
            chat_id = cq["message"]["chat"]["id"]
            message_id = cq["message"]["message_id"]
            callback_id = cq["id"]
            data = cq.get("data", "")
            handle_callback(chat_id, message_id, callback_id, data, conn)

        # Обычное сообщение
        elif "message" in update:
            msg = update["message"]
            chat_id = msg["chat"]["id"]
            text = msg.get("text", "")

            if text == "/start":
                clear_state(conn, chat_id)
                handle_main_menu(chat_id)
            elif text == "/menu":
                clear_state(conn, chat_id)
                handle_main_menu(chat_id)
            elif text == "/stats":
                conn_temp = db()
                cur = conn_temp.cursor()
                cur.execute(f"SELECT COUNT(*), COALESCE(SUM(CASE WHEN status='done' THEN amount ELSE 0 END),0) FROM {SCHEMA}.orders")
                total, rev = cur.fetchone()
                cur.close()
                conn_temp.close()
                send(chat_id, f"📊 Заказов: {total} | Выручка: {fmt_money(float(rev))}", kb_main())
            elif text:
                handle_text_input(chat_id, text, conn)

    finally:
        conn.close()

    return {"statusCode": 200, "headers": CORS, "body": "ok"}