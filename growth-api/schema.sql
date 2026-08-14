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

CREATE TABLE IF NOT EXISTS guardian_student_bindings (
  binding_id TEXT PRIMARY KEY,
  guardian_user_id TEXT NOT NULL,
  guardian_username TEXT NOT NULL,
  student_binding_id TEXT NOT NULL,
  teacher_user_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (student_binding_id) REFERENCES student_class_bindings(binding_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_bindings_guardian
  ON guardian_student_bindings(guardian_user_id, status);

CREATE INDEX IF NOT EXISTS idx_guardian_bindings_student
  ON guardian_student_bindings(teacher_user_id, class_id, student_id, status);

CREATE TABLE IF NOT EXISTS point_events (
  event_id TEXT PRIMARY KEY,
  teacher_user_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta BETWEEN -20 AND 20 AND delta != 0),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (teacher_user_id) REFERENCES teacher_qualifications(teacher_user_id)
);

CREATE INDEX IF NOT EXISTS idx_point_events_student
  ON point_events(teacher_user_id, class_id, student_id, created_at);