"""Управление рабочими мастерской: получение, создание, удаление."""
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
            cur.execute(f"SELECT id, name, phone, active, created_at FROM {SCHEMA}.workers ORDER BY id")
            rows = cur.fetchall()
            workers = [
                {"id": r[0], "name": r[1], "phone": r[2] or "", "active": r[3], "created_at": str(r[4])}
                for r in rows
            ]
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"workers": workers})}

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            name = body.get("name", "").strip()
            phone = body.get("phone", "").strip()
            if not name:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "name required"})}
            cur.execute(
                f"INSERT INTO {SCHEMA}.workers (name, phone) VALUES (%s, %s) RETURNING id",
                (name, phone or None)
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"id": new_id, "name": name, "phone": phone, "active": True})}

        if method == "DELETE":
            params = event.get("queryStringParameters") or {}
            worker_id = params.get("id")
            if not worker_id:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "id required"})}
            cur.execute(f"UPDATE {SCHEMA}.workers SET active = FALSE WHERE id = %s", (int(worker_id),))
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "method not allowed"})}

    finally:
        cur.close()
        conn.close()
