CREATE INDEX IF NOT EXISTS auth_rate_limits_window_idx
  ON auth_rate_limits (window_started_at);
