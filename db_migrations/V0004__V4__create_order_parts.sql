CREATE TABLE IF NOT EXISTS t_p60693553_workshop_bot_managem.order_parts (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL,
  part_id INTEGER NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  part_name VARCHAR(300) NOT NULL,
  part_unit VARCHAR(50) NOT NULL DEFAULT 'шт',
  created_at TIMESTAMP DEFAULT NOW()
)
