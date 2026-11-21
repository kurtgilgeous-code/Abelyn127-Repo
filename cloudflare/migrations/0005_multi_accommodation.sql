-- One booking can combine several accommodations (e.g. Bahay Hapag + Balai Delnor).
-- accommodation_ids is a JSON array of accommodation IDs; accommodation_id keeps the first
-- one and accommodation_name the combined display name ("Bahay Hapag + Balai Delnor").
ALTER TABLE bookings ADD COLUMN accommodation_ids TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(accommodation_ids) AND json_type(accommodation_ids) = 'array');

UPDATE bookings SET accommodation_ids = json_array(accommodation_id)
WHERE accommodation_ids = '[]';
