"""Управление заказами мастерской: список, создание, смена статуса, удаление, запчасти."""
import json
import os
import psycopg2

SCHEMA = "t_p60693553_workshop_bot_managem"
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_order_parts(cur, order_id):
    cur.execute(
        f"SELECT id, part_id, part_name, quantity, part_unit FROM {SCHEMA}.order_parts WHERE order_id = %s ORDER BY id",
        (order_id,)
    )
    return [
        {"id": r[0], "partId": r[1], "partName": r[2], "quantity": float(r[3]), "unit": r[4]}
        for r in cur.fetchall()
    ]


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    conn = get_conn()
    cur = conn.cursor()

    try:
        if method == "GET":
            params = event.get("queryStringParameters") or {}
            status_filter = params.get("status", "")
            date_from = params.get("date_from", "")
            date_to = params.get("date_to", "")
            order_id = params.get("order_id", "")

            # GET ?order_id=X — запчасти конкретного заказа
            if order_id:
                parts = get_order_parts(cur, int(order_id))
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"parts": parts})}

            sql = f"""
                SELECT o.id, o.title, o.worker_id, w.name as worker_name,
                       o.status, o.amount, o.description, o.date::text, o.created_at
                FROM {SCHEMA}.orders o
                LEFT JOIN {SCHEMA}.workers w ON w.id = o.worker_id
                WHERE 1=1
            """
            args = []
            if status_filter:
                sql += " AND o.status = %s"
                args.append(status_filter)
            if date_from:
                sql += " AND o.date >= %s"
                args.append(date_from)
            if date_to:
                sql += " AND o.date <= %s"
                args.append(date_to)
            sql += " ORDER BY o.id DESC"

            cur.execute(sql, args)
            rows = cur.fetchall()

            # Подгружаем запчасти для всех заказов одним запросом
            order_ids = [r[0] for r in rows]
            parts_map = {}
            if order_ids:
                placeholders = ",".join(["%s"] * len(order_ids))
                cur.execute(
                    f"SELECT order_id, id, part_id, part_name, quantity, part_unit FROM {SCHEMA}.order_parts WHERE order_id IN ({placeholders}) ORDER BY id",
                    order_ids
                )
                for pr in cur.fetchall():
                    oid = pr[0]
                    if oid not in parts_map:
                        parts_map[oid] = []
                    parts_map[oid].append({"id": pr[1], "partId": pr[2], "partName": pr[3], "quantity": float(pr[4]), "unit": pr[5]})

            orders = [
                {
                    "id": r[0], "title": r[1], "workerId": r[2],
                    "workerName": r[3] or "", "status": r[4],
                    "amount": float(r[5]), "description": r[6] or "",
                    "date": r[7], "created_at": str(r[8]),
                    "parts": parts_map.get(r[0], [])
                }
                for r in rows
            ]
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"orders": orders})}

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            action = body.get("action", "create")

            # Добавить запчасть к заказу
            if action == "add_part":
                order_id = body.get("orderId")
                part_id = body.get("partId")
                part_name = body.get("partName", "")
                quantity = float(body.get("quantity", 1))
                part_unit = body.get("unit", "шт")
                if not order_id or not part_id:
                    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "orderId and partId required"})}

                # Проверяем достаточно ли на складе
                cur.execute(f"SELECT quantity FROM {SCHEMA}.parts WHERE id = %s", (int(part_id),))
                row = cur.fetchone()
                if not row or float(row[0]) < quantity:
                    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "недостаточно на складе"})}

                # Списываем со склада
                cur.execute(
                    f"UPDATE {SCHEMA}.parts SET quantity = quantity - %s WHERE id = %s",
                    (quantity, int(part_id))
                )
                # Записываем в order_parts
                cur.execute(
                    f"INSERT INTO {SCHEMA}.order_parts (order_id, part_id, part_name, quantity, part_unit) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (int(order_id), int(part_id), part_name, quantity, part_unit)
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"id": new_id, "ok": True})}

            # Удалить запчасть из заказа (вернуть на склад)
            if action == "remove_part":
                op_id = body.get("orderPartId")
                if not op_id:
                    return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "orderPartId required"})}
                cur.execute(f"SELECT part_id, quantity FROM {SCHEMA}.order_parts WHERE id = %s", (int(op_id),))
                row = cur.fetchone()
                if row:
                    cur.execute(f"UPDATE {SCHEMA}.parts SET quantity = quantity + %s WHERE id = %s", (float(row[1]), int(row[0])))
                    cur.execute(f"DELETE FROM {SCHEMA}.order_parts WHERE id = %s", (int(op_id),))
                conn.commit()
                return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

            # Создать заказ
            title = body.get("title", "").strip()
            worker_id = body.get("workerId")
            amount = body.get("amount", 0)
            description = body.get("description", "").strip()
            date = body.get("date", "")

            if not title or not worker_id:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "title and workerId required"})}

            cur.execute(
                f"INSERT INTO {SCHEMA}.orders (title, worker_id, amount, description, date) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (title, int(worker_id), float(amount), description or None, date or None)
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"id": new_id, "status": "new"})}

        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            order_id = body.get("id")
            new_status = body.get("status")
            if not order_id or not new_status:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "id and status required"})}
            if new_status not in ("new", "progress", "done"):
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "invalid status"})}
            cur.execute(f"UPDATE {SCHEMA}.orders SET status = %s WHERE id = %s", (new_status, int(order_id)))
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        if method == "DELETE":
            params = event.get("queryStringParameters") or {}
            order_id = params.get("id")
            if not order_id:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "id required"})}
            # Возвращаем все запчасти на склад перед удалением заказа
            cur.execute(f"SELECT part_id, quantity FROM {SCHEMA}.order_parts WHERE order_id = %s", (int(order_id),))
            for pr in cur.fetchall():
                cur.execute(f"UPDATE {SCHEMA}.parts SET quantity = quantity + %s WHERE id = %s", (float(pr[1]), int(pr[0])))
            cur.execute(f"DELETE FROM {SCHEMA}.order_parts WHERE order_id = %s", (int(order_id),))
            cur.execute(f"DELETE FROM {SCHEMA}.orders WHERE id = %s", (int(order_id),))
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "method not allowed"})}

    finally:
        cur.close()
        conn.close()