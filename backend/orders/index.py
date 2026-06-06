"""Управление заказами мастерской: список, создание, смена статуса, удаление."""
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
            orders = [
                {
                    "id": r[0], "title": r[1], "workerId": r[2],
                    "workerName": r[3] or "", "status": r[4],
                    "amount": float(r[5]), "description": r[6] or "",
                    "date": r[7], "created_at": str(r[8])
                }
                for r in rows
            ]
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"orders": orders})}

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            title = body.get("title", "").strip()
            worker_id = body.get("workerId")
            amount = body.get("amount", 0)
            description = body.get("description", "").strip()
            date = body.get("date", "")

            if not title or not worker_id:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "title and workerId required"})}

            sql = f"""
                INSERT INTO {SCHEMA}.orders (title, worker_id, amount, description, date)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
            """
            cur.execute(sql, (title, int(worker_id), float(amount), description or None, date or None))
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
            cur.execute(f"DELETE FROM {SCHEMA}.orders WHERE id = %s", (int(order_id),))
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "method not allowed"})}

    finally:
        cur.close()
        conn.close()
