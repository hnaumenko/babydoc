-- Migration: Create users table for persistent user data
-- Run this in Supabase SQL Editor

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  child_birth_date DATE,
  child_name TEXT,
  language TEXT DEFAULT 'uk',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookup by telegram_id
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- Create function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create source_registry table for book metadata
CREATE TABLE IF NOT EXISTS source_registry (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  source_type TEXT NOT NULL DEFAULT 'general',
  age_range_min_months INTEGER DEFAULT 0,
  age_range_max_months INTEGER DEFAULT 216,
  reliability_score INTEGER DEFAULT 3,
  topics TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert source registry data for existing books
INSERT INTO source_registry (filename, title, language, source_type, age_range_min_months, age_range_max_months, reliability_score, topics) VALUES
  ('caring-for-your-baby-and-young-child-birth-to-age-5_compress.pdf', 'Caring for Your Baby and Young Child (AAP)', 'en', 'medical_guide', 0, 60, 5, ARRAY['general_care', 'illness', 'development', 'feeding', 'sleep']),
  ('Heading Home with Your Newborn  From Birth to Reality (Laura A. Jana Jennifer Shu) (Z-Library).pdf', 'Heading Home with Your Newborn', 'en', 'medical_guide', 0, 12, 5, ARRAY['newborn_care', 'feeding', 'sleep', 'health']),
  ('How Children Develop 6th Canadian Edition By Robert S. Siegler ( etc.) (Z-Library).pdf', 'How Children Develop', 'en', 'textbook', 0, 216, 4, ARRAY['development', 'psychology', 'milestones']),
  ('The Whole-Brain Child 12 Revolutionary Strategies to Nurture Your Childs Developing Mind (Daniel J. Siegel) (Z-Library).pdf', 'The Whole-Brain Child', 'en', 'parenting_book', 12, 144, 3, ARRAY['psychology', 'behavior', 'emotions']),
  ('_OceanofPDF.com_Baby_Leads_the_Way_-_Julie_Laux.pdf', 'Baby Leads the Way', 'en', 'parenting_book', 6, 24, 2, ARRAY['feeding', 'weaning', 'blw'])
ON CONFLICT (filename) DO UPDATE SET
  title = EXCLUDED.title,
  language = EXCLUDED.language,
  source_type = EXCLUDED.source_type,
  age_range_min_months = EXCLUDED.age_range_min_months,
  age_range_max_months = EXCLUDED.age_range_max_months,
  reliability_score = EXCLUDED.reliability_score,
  topics = EXCLUDED.topics;

-- Add child_age_months column to request_logs if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'request_logs' AND column_name = 'child_age_months'
  ) THEN
    ALTER TABLE request_logs ADD COLUMN child_age_months INTEGER;
  END IF;
END $$;

-- Grant permissions (adjust as needed)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE source_registry ENABLE ROW LEVEL SECURITY;
