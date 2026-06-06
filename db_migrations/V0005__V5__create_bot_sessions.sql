CREATE TABLE IF NOT EXISTS t_p60693553_workshop_bot_managem.bot_sessions (
  chat_id VARCHAR(50) PRIMARY KEY,
  state VARCHAR(100),
  data TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
)
