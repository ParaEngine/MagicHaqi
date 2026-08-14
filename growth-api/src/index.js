const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function corsOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return '';
  const allowedOrigins = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return allowedOrigins.includes(origin) ? origin : '';
}

function withCors(response, request, env) {
  const origin = corsOrigin(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-headers', 'authorization, content-type');
  headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('access-control-max-age', '86400');
  headers.append('vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function bearerToken(request) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function text(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function validKey(value) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

function validLabelKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validSitePath(value) {
  return /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(value);
}

function classKey(userId, classId) {
  return `${userId}:${classId}`;
}

function inviteCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32]).join('');
}

async function keepworkIdentity(request, env) {
  const token = bearerToken(request);
  if (!token) throw new Response('Missing bearer token', { status: 401 });
  const profileUrl = env.KEEPWORK_PROFILE_URL || 'https://api.keepwork.com/core/v0/users/profile';
  const response = await fetch(profileUrl, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    cf: { cacheTtl: 0 }
  });
  if (!response.ok) throw new Response('Invalid KeepWork session', { status: 401 });
  const payload = await response.json();
  const user = payload?.user || payload?.data?.user || payload?.data || payload;
  const userId = text(user?.id || user?._id, 80);
  const username = text(user?.username || user?.name, 80).toLowerCase();
  if (!userId || !username) throw new Response('Incomplete KeepWork identity', { status: 401 });
  return { userId, username };
}

function keepworkUser(payload) {
  const candidates = Array.isArray(payload) ? payload
    : Array.isArray(payload?.rows) ? payload.rows
      : Array.isArray(payload?.data?.rows) ? payload.data.rows
        : [payload?.user || payload?.data?.user || payload?.data || payload];
  return candidates.filter(Boolean);
}

async function resolveKeepworkUser(request, env, username) {
  const token = bearerToken(request);
  const apiBase = String(env.KEEPWORK_API_BASE || 'https://api.keepwork.com/core/v0').replace(/\/$/, '');
  const response = await fetch(`${apiBase}/users?username=${encodeURIComponent(username)}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    cf: { cacheTtl: 0 }
  });
  if (!response.ok) throw new Response('KeepWork user directory is unavailable', { status: 502 });
  const users = keepworkUser(await response.json());
  const user = users.find(item => text(item?.username || item?.name, 80).toLowerCase() === username);
  const userId = text(user?.id || user?.userId || user?._id, 80);
  if (userId) return { userId, username };
  throw new Response('Student KeepWork account was not found', { status: 400 });
}

async function activeTeacher(env, identity, classId) {
  const row = await env.DB.prepare(`
    SELECT tq.school_id, cm.role
    FROM teacher_qualifications tq
    JOIN class_memberships cm ON cm.teacher_user_id = tq.teacher_user_id
    WHERE tq.teacher_user_id = ?1 AND tq.status = 'active'
      AND (tq.expires_at IS NULL OR tq.expires_at > unixepoch())
      AND cm.class_id = ?2 AND cm.status = 'active'
      AND cm.role IN ('owner', 'teacher')
  `).bind(identity.userId, classId).first();
  if (!row) throw new Response('Teacher is not authorized for this class', { status: 403 });
  return row;
}

async function createClass(request, env) {
  const identity = await keepworkIdentity(request, env);
  const body = await request.json().catch(() => null);
  const classId = text(body?.classId, 80);
  const className = text(body?.className, 120);
  const sitePath = text(body?.sitePath, 160);
  if (!validLabelKey(classId) || !className || !validSitePath(sitePath)) return json({ error: 'Invalid class fields' }, 400);
  if (sitePath.split('/')[0].toLowerCase() !== identity.username) return json({ error: 'Teacher must own the shared site' }, 403);
  const key = classKey(identity.userId, classId);
  const existing = await env.DB.prepare('SELECT invite_code FROM classes WHERE class_key = ?1').bind(key).first();
  let code = existing?.invite_code || '';
  if (!code) {
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = inviteCode();
      const duplicate = await env.DB.prepare('SELECT 1 FROM classes WHERE invite_code = ?1').bind(candidate).first();
      if (!duplicate) code = candidate;
    }
  }
  if (!code) return json({ error: 'Unable to allocate invitation code' }, 503);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO teacher_qualifications (teacher_user_id, school_id, status, verified_by, verified_at)
      VALUES (?1, ?2, 'active', 'self-service', unixepoch())
      ON CONFLICT(teacher_user_id) DO UPDATE SET status = 'active'
    `).bind(identity.userId, `personal:${identity.userId}`),
    env.DB.prepare(`
      INSERT INTO class_memberships (class_id, teacher_user_id, role, status)
      VALUES (?1, ?2, 'owner', 'active')
      ON CONFLICT(class_id, teacher_user_id) DO UPDATE SET role = 'owner', status = 'active'
    `).bind(classId, identity.userId),
    env.DB.prepare(`
      INSERT INTO classes (class_key, class_id, class_name, owner_user_id, owner_username, site_path, invite_code, status, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', unixepoch(), unixepoch())
      ON CONFLICT(class_key) DO UPDATE SET class_name = excluded.class_name, site_path = excluded.site_path,
        status = 'active', updated_at = unixepoch()
    `).bind(key, classId, className, identity.userId, identity.username, sitePath, code)
  ]);
  return json({ classId, className, sitePath, inviteCode: code, role: 'owner', status: 'active' }, existing ? 200 : 201);
}

async function createClassInvitation(request, env) {
  const identity = await keepworkIdentity(request, env);
  const body = await request.json().catch(() => null);
  const classId = text(body?.classId, 80);
  const studentId = text(body?.studentId, 80);
  const studentUsername = text(body?.studentUsername, 80).toLowerCase();
  if (!validLabelKey(classId) || !validKey(studentId) || !validKey(studentUsername)) return json({ error: 'Invalid invitation fields' }, 400);
  await activeTeacher(env, identity, classId);
  const ownedClass = await env.DB.prepare(`
    SELECT class_key FROM classes WHERE owner_user_id = ?1 AND class_id = ?2 AND status = 'active'
  `).bind(identity.userId, classId).first();
  if (!ownedClass) return json({ error: 'Class has not been created' }, 404);
  const student = await resolveKeepworkUser(request, env, studentUsername);
  const invitationId = `${ownedClass.class_key}:${student.userId}`;
  await env.DB.prepare(`
    INSERT INTO class_invitations (invitation_id, class_key, class_id, teacher_user_id, student_user_id,
      student_username, student_id, status, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', unixepoch(), unixepoch())
    ON CONFLICT(class_key, student_user_id) DO UPDATE SET student_username = excluded.student_username,
      student_id = excluded.student_id, status = 'pending', updated_at = unixepoch()
  `).bind(invitationId, ownedClass.class_key, classId, identity.userId, student.userId, student.username, studentId).run();
  return json({ invitationId, classId, studentId, studentUsername, status: 'pending' }, 201);
}

async function listMyClassInvitations(request, env) {
  const identity = await keepworkIdentity(request, env);
  const result = await env.DB.prepare(`
    SELECT ci.invitation_id, ci.class_id, ci.student_id, ci.status, ci.updated_at,
      c.class_name, c.owner_username, c.site_path
    FROM class_invitations ci JOIN classes c ON c.class_key = ci.class_key
    WHERE ci.student_user_id = ?1 AND ci.status = 'pending' AND c.status = 'active'
    ORDER BY ci.updated_at DESC
  `).bind(identity.userId).all();
  return json({ invitations: (result.results || []).map(row => ({
    invitationId: row.invitation_id, classId: row.class_id, className: row.class_name,
    studentId: row.student_id, teacherUsername: row.owner_username, sitePath: row.site_path,
    status: row.status, updatedAt: row.updated_at * 1000
  })) });
}

async function activateInvitation(request, env, invitationId, decision) {
  const identity = await keepworkIdentity(request, env);
  const invitation = await env.DB.prepare(`
    SELECT ci.*, c.class_name, c.owner_username, c.site_path
    FROM class_invitations ci JOIN classes c ON c.class_key = ci.class_key
    WHERE ci.invitation_id = ?1 AND ci.student_user_id = ?2 AND ci.status = 'pending' AND c.status = 'active'
  `).bind(invitationId, identity.userId).first();
  if (!invitation) return json({ error: 'Pending invitation not found' }, 404);
  if (decision === 'declined') {
    await env.DB.prepare("UPDATE class_invitations SET status = 'declined', updated_at = unixepoch() WHERE invitation_id = ?1").bind(invitationId).run();
    return json({ invitationId, status: 'declined' });
  }
  const bindingId = `${invitation.teacher_user_id}:${invitation.class_id}:${invitation.student_id}`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO student_class_bindings (binding_id, student_user_id, student_username, teacher_user_id,
        teacher_username, teacher_name, school_id, class_id, class_name, student_id, site_path, status, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10, 'active', unixepoch(), unixepoch())
      ON CONFLICT(binding_id) DO UPDATE SET student_user_id = excluded.student_user_id,
        student_username = excluded.student_username, status = 'active', updated_at = unixepoch()
    `).bind(bindingId, identity.userId, identity.username, invitation.teacher_user_id,
      invitation.owner_username, `personal:${invitation.teacher_user_id}`, invitation.class_id,
      invitation.class_name, invitation.student_id, invitation.site_path),
    env.DB.prepare("UPDATE class_invitations SET status = 'accepted', updated_at = unixepoch() WHERE invitation_id = ?1").bind(invitationId)
  ]);
  return json({ invitationId, bindingId, status: 'accepted' });
}

async function joinClassByCode(request, env) {
  const identity = await keepworkIdentity(request, env);
  const body = await request.json().catch(() => null);
  const code = text(body?.inviteCode, 20).toUpperCase();
  const ownedClass = await env.DB.prepare(`
    SELECT class_key, class_id, owner_user_id FROM classes WHERE invite_code = ?1 AND status = 'active'
  `).bind(code).first();
  if (!ownedClass) return json({ error: 'Invitation code is invalid' }, 404);
  const existing = await env.DB.prepare(`
    SELECT invitation_id FROM class_invitations WHERE class_key = ?1 AND student_user_id = ?2
  `).bind(ownedClass.class_key, identity.userId).first();
  const studentId = text(body?.studentId, 80) || `stu_${identity.userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70)}`;
  const invitationId = existing?.invitation_id || `${ownedClass.class_key}:${identity.userId}`;
  await env.DB.prepare(`
    INSERT INTO class_invitations (invitation_id, class_key, class_id, teacher_user_id, student_user_id,
      student_username, student_id, status, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', unixepoch(), unixepoch())
    ON CONFLICT(class_key, student_user_id) DO UPDATE SET student_username = excluded.student_username,
      student_id = excluded.student_id, status = 'pending', updated_at = unixepoch()
  `).bind(invitationId, ownedClass.class_key, ownedClass.class_id, ownedClass.owner_user_id,
    identity.userId, identity.username, studentId).run();
  return activateInvitation(request, env, invitationId, 'accepted');
}

async function listClassMembers(request, env, classId) {
  const identity = await keepworkIdentity(request, env);
  await activeTeacher(env, identity, classId);
  const result = await env.DB.prepare(`
    SELECT ci.invitation_id, ci.student_username, ci.student_id, ci.status, ci.updated_at
    FROM class_invitations ci WHERE ci.teacher_user_id = ?1 AND ci.class_id = ?2
    ORDER BY ci.updated_at DESC
  `).bind(identity.userId, classId).all();
  return json({ classId, members: (result.results || []).map(row => ({
    invitationId: row.invitation_id, studentUsername: row.student_username,
    studentId: row.student_id, status: row.status, updatedAt: row.updated_at * 1000
  })) });
}

async function listStudentBindings(request, env) {
  const identity = await keepworkIdentity(request, env);
  const result = await env.DB.prepare(`
    SELECT scb.binding_id, scb.teacher_user_id, scb.teacher_username, scb.teacher_name,
      scb.school_id, scb.class_id, scb.class_name, scb.student_id, scb.site_path, scb.updated_at
    FROM student_class_bindings scb
    JOIN teacher_qualifications tq ON tq.teacher_user_id = scb.teacher_user_id
    JOIN class_memberships cm
      ON cm.teacher_user_id = scb.teacher_user_id AND cm.class_id = scb.class_id
    WHERE scb.student_user_id = ?1 AND scb.status = 'active'
      AND tq.status = 'active'
      AND (tq.expires_at IS NULL OR tq.expires_at > unixepoch())
      AND cm.status = 'active' AND cm.role IN ('owner', 'teacher')
    ORDER BY scb.class_name COLLATE NOCASE, scb.teacher_name COLLATE NOCASE
  `).bind(identity.userId).all();
  return json({
    student: { userId: identity.userId, username: identity.username },
    bindings: (result.results || []).map(row => ({
      bindingId: row.binding_id,
      teacherUserId: row.teacher_user_id,
      teacherUsername: row.teacher_username,
      teacherName: row.teacher_name,
      schoolId: row.school_id,
      classId: row.class_id,
      className: row.class_name,
      studentId: row.student_id,
      sitePath: row.site_path,
      updatedAt: row.updated_at * 1000
    }))
  });
}

async function upsertStudentBinding(request, env) {
  const identity = await keepworkIdentity(request, env);
  const body = await request.json().catch(() => null);
  const classId = text(body?.classId, 80);
  const studentUsername = text(body?.studentUsername, 80).toLowerCase();
  const studentId = text(body?.studentId, 80);
  const sitePath = text(body?.sitePath, 160);
  if (!validLabelKey(classId) || !validKey(studentId)
    || !validKey(studentUsername) || !validSitePath(sitePath)) {
    return json({ error: 'Invalid binding fields' }, 400);
  }
  const teacher = await activeTeacher(env, identity, classId);
  const studentIdentity = await resolveKeepworkUser(request, env, studentUsername);
  const siteOwner = sitePath.split('/')[0].toLowerCase();
  if (siteOwner !== identity.username) return json({ error: 'Teacher must own the shared site' }, 403);
  const bindingId = `${identity.userId}:${classId}:${studentId}`;
  const existingBinding = await env.DB.prepare(`
    SELECT student_user_id
    FROM student_class_bindings
    WHERE binding_id = ?1
  `).bind(bindingId).first();
  if (existingBinding && String(existingBinding.student_user_id) !== studentIdentity.userId) {
    return json({ error: 'Student account rebind requires an administrator operation' }, 409);
  }
  await env.DB.prepare(`
    INSERT INTO student_class_bindings (
      binding_id, student_user_id, student_username, teacher_user_id,
      teacher_username, teacher_name, school_id, class_id, class_name,
      student_id, site_path, status, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'active', unixepoch(), unixepoch())
    ON CONFLICT(binding_id) DO UPDATE SET
      student_user_id = excluded.student_user_id,
      student_username = excluded.student_username,
      teacher_username = excluded.teacher_username,
      teacher_name = excluded.teacher_name,
      school_id = excluded.school_id,
      class_name = excluded.class_name,
      student_id = excluded.student_id,
      site_path = excluded.site_path,
      status = 'active',
      updated_at = unixepoch()
  `).bind(
    bindingId, studentIdentity.userId, studentUsername, identity.userId, identity.username,
    text(body?.teacherName || identity.username, 80), teacher.school_id, classId,
    text(body?.className, 120), studentId, sitePath
  ).run();
  return json({ bindingId, status: 'active' }, 201);
}

async function revokeStudentBinding(request, env, bindingId) {
  const identity = await keepworkIdentity(request, env);
  const binding = await env.DB.prepare(
    'SELECT class_id FROM student_class_bindings WHERE binding_id = ?1 AND teacher_user_id = ?2'
  ).bind(bindingId, identity.userId).first();
  if (!binding) return json({ error: 'Binding not found' }, 404);
  await activeTeacher(env, identity, binding.class_id);
  await env.DB.prepare(`
    UPDATE student_class_bindings SET status = 'revoked', updated_at = unixepoch()
    WHERE binding_id = ?1 AND teacher_user_id = ?2
  `).bind(bindingId, identity.userId).run();
  return json({ bindingId, status: 'revoked' });
}

async function teacherStudentBinding(env, identity, classId, studentId) {
  await activeTeacher(env, identity, classId);
  const binding = await env.DB.prepare(`
    SELECT binding_id, site_path, student_username
    FROM student_class_bindings
    WHERE teacher_user_id = ?1 AND class_id = ?2 AND student_id = ?3 AND status = 'active'
  `).bind(identity.userId, classId, studentId).first();
  if (!binding) throw new Response('Student is not actively bound to this class', { status: 403 });
  return binding;
}

async function replaceGuardianBindings(request, env) {
  const identity = await keepworkIdentity(request, env);
  const body = await request.json().catch(() => null);
  const classId = text(body?.classId, 80);
  const studentId = text(body?.studentId, 80);
  const usernames = [...new Set((Array.isArray(body?.guardianUsernames) ? body.guardianUsernames : [])
    .map(value => text(value, 80).toLowerCase()).filter(Boolean))];
  if (!validLabelKey(classId) || !validKey(studentId) || !usernames.length
    || usernames.length > 8 || usernames.some(username => !validKey(username))) {
    return json({ error: 'Invalid guardian binding fields' }, 400);
  }
  const studentBinding = await teacherStudentBinding(env, identity, classId, studentId);
  const guardians = [];
  for (const username of usernames) guardians.push(await resolveKeepworkUser(request, env, username));
  const statements = [env.DB.prepare(`
    UPDATE guardian_student_bindings SET status = 'revoked', updated_at = unixepoch()
    WHERE teacher_user_id = ?1 AND class_id = ?2 AND student_id = ?3
  `).bind(identity.userId, classId, studentId)];
  guardians.forEach(guardian => {
    const bindingId = `${studentBinding.binding_id}:${guardian.userId}`;
    statements.push(env.DB.prepare(`
      INSERT INTO guardian_student_bindings (
        binding_id, guardian_user_id, guardian_username, student_binding_id,
        teacher_user_id, class_id, student_id, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', unixepoch(), unixepoch())
      ON CONFLICT(binding_id) DO UPDATE SET
        guardian_username = excluded.guardian_username,
        student_binding_id = excluded.student_binding_id,
        status = 'active', updated_at = unixepoch()
    `).bind(bindingId, guardian.userId, guardian.username, studentBinding.binding_id,
      identity.userId, classId, studentId));
  });
  await env.DB.batch(statements);
  return json({ classId, studentId, guardianUsernames: guardians.map(item => item.username), status: 'active' }, 201);
}

async function listGuardianBindings(request, env) {
  const identity = await keepworkIdentity(request, env);
  const result = await env.DB.prepare(`
    SELECT gsb.binding_id, gsb.guardian_username, scb.teacher_username, scb.teacher_name,
      scb.school_id, scb.class_id, scb.class_name, scb.student_id, scb.site_path, gsb.updated_at
    FROM guardian_student_bindings gsb
    JOIN student_class_bindings scb ON scb.binding_id = gsb.student_binding_id
    JOIN teacher_qualifications tq ON tq.teacher_user_id = gsb.teacher_user_id
    JOIN class_memberships cm ON cm.teacher_user_id = gsb.teacher_user_id AND cm.class_id = gsb.class_id
    WHERE gsb.guardian_user_id = ?1 AND gsb.status = 'active' AND scb.status = 'active'
      AND tq.status = 'active' AND (tq.expires_at IS NULL OR tq.expires_at > unixepoch())
      AND cm.status = 'active' AND cm.role IN ('owner', 'teacher')
    ORDER BY scb.class_name COLLATE NOCASE, scb.teacher_name COLLATE NOCASE
  `).bind(identity.userId).all();
  return json({
    guardian: { userId: identity.userId, username: identity.username },
    bindings: (result.results || []).map(row => ({
      bindingId: row.binding_id,
      guardianUsername: row.guardian_username,
      teacherUsername: row.teacher_username,
      teacherName: row.teacher_name,
      schoolId: row.school_id,
      classId: row.class_id,
      className: row.class_name,
      studentId: row.student_id,
      sitePath: row.site_path,
      updatedAt: row.updated_at * 1000
    }))
  });
}

async function createPointEvent(request, env) {
  const identity = await keepworkIdentity(request, env);
  const body = await request.json().catch(() => null);
  const eventId = text(body?.eventId, 80);
  const classId = text(body?.classId, 80);
  const studentId = text(body?.studentId, 80);
  const delta = Math.trunc(Number(body?.delta));
  const reason = text(body?.reason, 160);
  if (!validKey(eventId) || !validLabelKey(classId) || !validKey(studentId)
    || !Number.isInteger(delta) || delta === 0 || delta < -20 || delta > 20 || !reason) {
    return json({ error: 'Invalid point event fields' }, 400);
  }
  await teacherStudentBinding(env, identity, classId, studentId);
  const existing = await env.DB.prepare(`
    SELECT teacher_user_id, class_id, student_id, delta, reason
    FROM point_events WHERE event_id = ?1
  `).bind(eventId).first();
  if (existing) {
    const matches = existing.teacher_user_id === identity.userId && existing.class_id === classId
      && existing.student_id === studentId && Number(existing.delta) === delta && existing.reason === reason;
    if (!matches) return json({ error: 'Point event id is already used' }, 409);
    return json({ eventId, status: 'accepted', duplicate: true });
  }
  await env.DB.prepare(`
    INSERT INTO point_events (event_id, teacher_user_id, class_id, student_id, delta, reason, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
  `).bind(eventId, identity.userId, classId, studentId, delta, reason).run();
  return json({ eventId, status: 'accepted', duplicate: false }, 201);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') {
        if (!corsOrigin(request, env)) return new Response(null, { status: 403 });
        return withCors(new Response(null, { status: 204 }), request, env);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/students/me/class-bindings') {
        return withCors(await listStudentBindings(request, env), request, env);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/students/me/class-invitations') {
        return withCors(await listMyClassInvitations(request, env), request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/students/join-by-code') {
        return withCors(await joinClassByCode(request, env), request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/teacher/classes') {
        return withCors(await createClass(request, env), request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/teacher/class-invitations') {
        return withCors(await createClassInvitation(request, env), request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/teacher/class-bindings') {
        return withCors(json({ error: 'Direct student binding is disabled; send a class invitation instead' }, 410), request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/teacher/guardian-bindings') {
        return withCors(await replaceGuardianBindings(request, env), request, env);
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/guardians/me/student-bindings') {
        return withCors(await listGuardianBindings(request, env), request, env);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/teacher/point-events') {
        return withCors(await createPointEvent(request, env), request, env);
      }
      const memberMatch = url.pathname.match(/^\/api\/v1\/teacher\/classes\/([^/]+)\/members$/);
      if (request.method === 'GET' && memberMatch) {
        return withCors(await listClassMembers(request, env, decodeURIComponent(memberMatch[1])), request, env);
      }
      const invitationDecisionMatch = url.pathname.match(/^\/api\/v1\/students\/me\/class-invitations\/([^/]+)\/(accept|decline)$/);
      if (request.method === 'POST' && invitationDecisionMatch) {
        return withCors(await activateInvitation(request, env, decodeURIComponent(invitationDecisionMatch[1]), invitationDecisionMatch[2] === 'accept' ? 'accepted' : 'declined'), request, env);
      }
      const revokeMatch = url.pathname.match(/^\/api\/v1\/teacher\/class-bindings\/([^/]+)$/);
      if (request.method === 'DELETE' && revokeMatch) {
        return withCors(await revokeStudentBinding(request, env, decodeURIComponent(revokeMatch[1])), request, env);
      }
      return withCors(json({ error: 'Not found' }, 404), request, env);
    } catch (error) {
      if (error instanceof Response) return withCors(error, request, env);
      console.error('growth-api request failed', error);
      return withCors(json({ error: 'Internal server error' }, 500), request, env);
    }
  }
};