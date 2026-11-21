-- Guests the customer added beyond the rooms' pax, by type, as JSON
-- ({"adults":1,"seniorsPwd":0,"children":1}). They pay the entrance fee; NULL on older
-- bookings and when every guest pays entrance (Day Tour, Gazebo, Calesa Tables, Kubo).
ALTER TABLE bookings ADD COLUMN extra_guests TEXT;
