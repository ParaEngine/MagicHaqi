CREATE TABLE IF NOT EXISTS teacher_qualifications (
  teacher_user_id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  verified_by TEXT,
  verified_at INTEGER,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS class_memberships (
  class_id TEXT NOT NULL,
  teacher_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'teacher', 'assistant')),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (class_id, teacher_user_id),
  FOREIGN KEY (teacher_user_id) REFERENCES teacher_qualifications(teacher_user_id)
);

CREATE TABLE IF NOT EXISTS student_class_bindings (
  binding_id TEXT PRIMARY KEY,
  student_user_id TEXT NOT NULL,
  student_username TEXT NOT NULL,
  teacher_user_id TEXT NOT NULL,
  teacher_username TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  school_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  class_name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  site_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (teacher_user_id) REFERENCES teacher_qualifications(teacher_user_id)
);

CREATE INDEX IF NOT EXISTS idx_bindings_student
  ON student_class_bindings(student_user_id, status);

CREATE INDEX IF NOT EXISTS idx_bindings_teacher
  ON student_class_bindings(teacher_user_id, class_id, status);