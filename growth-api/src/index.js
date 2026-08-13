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
      if (request.method === 'POST' && url.pathname === '/api/v1/teacher/class-bindings') {
        return withCors(await upsertStudentBinding(request, env), request, env);
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