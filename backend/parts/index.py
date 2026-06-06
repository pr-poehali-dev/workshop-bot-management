"""Управление запчастями: список, добавление, изменение остатков, удаление."""
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
            cur.execute(f"SELECT id, name, quantity, unit, min_stock FROM {SCHEMA}.parts ORDER BY id")
            rows = cur.fetchall()
            parts = [
                {"id": r[0], "name": r[1], "quantity": float(r[2]), "unit": r[3], "minStock": float(r[4])}
                for r in rows
            ]
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"parts": parts})}

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            name = body.get("name", "").strip()
            quantity = body.get("quantity", 0)
            unit = body.get("unit", "шт").strip()
            min_stock = body.get("minStock", 5)
            if not name:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "name required"})}
            cur.execute(
                f"INSERT INTO {SCHEMA}.parts (name, quantity, unit, min_stock) VALUES (%s, %s, %s, %s) RETURNING id",
                (name, float(quantity), unit, float(min_stock))
            )
            new_id = cur.fetchone()[0]
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"id": new_id})}

        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            part_id = body.get("id")
            delta = body.get("delta")  # +1 / -1
            if part_id is None or delta is None:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "id and delta required"})}
            cur.execute(
                f"UPDATE {SCHEMA}.parts SET quantity = GREATEST(0, quantity + %s) WHERE id = %s RETURNING quantity",
                (float(delta), int(part_id))
            )
            row = cur.fetchone()
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"quantity": float(row[0]) if row else 0})}

        if method == "DELETE":
            params = event.get("queryStringParameters") or {}
            part_id = params.get("id")
            if not part_id:
                return {"statusCode": 400, "headers": CORS, "body": json.dumps({"error": "id required"})}
            cur.execute(f"DELETE FROM {SCHEMA}.parts WHERE id = %s", (int(part_id),))
            conn.commit()
            return {"statusCode": 200, "headers": CORS, "body": json.dumps({"ok": True})}

        return {"statusCode": 405, "headers": CORS, "body": json.dumps({"error": "method not allowed"})}

    finally:
        cur.close()
        conn.close()
