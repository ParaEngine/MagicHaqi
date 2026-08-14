-- Self-service classes and student-confirmed membership.
-- This migration is additive and can be applied repeatedly to an existing D1 database.

CREATE TABLE IF NOT EXISTS classes (
  class_key TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  class_name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  owner_username TEXT NOT NULL,
  site_path TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_user_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_classes_owner
  ON classes(owner_user_id, status);

CREATE TABLE IF NOT EXISTS class_invitations (
  invitation_id TEXT PRIMARY KEY,
  class_key TEXT NOT NULL,
  class_id TEXT NOT NULL,
  teacher_user_id TEXT NOT NULL,
  student_user_id TEXT NOT NULL,
  student_username TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(class_key, student_user_id),
  FOREIGN KEY (class_key) REFERENCES classes(class_key)
);

CREATE INDEX IF NOT EXISTS idx_class_invitations_student
  ON class_invitations(student_user_id, status, updated_at);