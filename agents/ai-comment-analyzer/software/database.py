"""
数据库模块
负责 SQLite 数据库的初始化、连接管理以及评论和分析结果的 CRUD 操作。
支持多平台评论存储。
"""

import sqlite3
import os
from datetime import datetime
from typing import List, Dict, Optional, Tuple


class Database:
    """SQLite 数据库管理类"""

    def __init__(self, db_path: str = "socialecho.db"):
        """
        初始化数据库连接

        Args:
            db_path: SQLite 数据库文件路径
        """
        self.db_path = db_path
        self.conn = None
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """获取数据库连接，每次调用创建新连接以支持多线程"""
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _execute(self, query: str, params: tuple = ()) -> sqlite3.Cursor:
        """执行 SQL 并自动提交"""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        return cursor

    def _fetchall(self, query: str, params: tuple = ()) -> List:
        """执行查询并返回所有结果"""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(query, params)
        return cursor.fetchall()

    def _fetchone(self, query: str, params: tuple = ()) -> Optional:
        """执行查询并返回单条结果"""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(query, params)
        return cursor.fetchone()

    def _init_db(self) -> None:
        """初始化数据库表结构"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            # 创建评论表 - 存储原始评论数据（支持多平台）
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS comments (
                    id TEXT PRIMARY KEY,
                    post_id TEXT NOT NULL,
                    platform TEXT NOT NULL DEFAULT 'twitter',
                    author_id TEXT,
                    author_username TEXT,
                    author_name TEXT,
                    author_avatar TEXT,
                    text TEXT NOT NULL,
                    created_at TEXT,
                    like_count INTEGER DEFAULT 0,
                    reply_count INTEGER DEFAULT 0,
                    share_count INTEGER DEFAULT 0,
                    ip_location TEXT,
                    source TEXT,
                    fetched_at TEXT NOT NULL
                )
            """)

            # 迁移旧表：添加新字段（如果不存在）
            self._add_column_if_not_exists("comments", "platform", "TEXT NOT NULL DEFAULT 'twitter'")
            self._add_column_if_not_exists("comments", "author_avatar", "TEXT")
            self._add_column_if_not_exists("comments", "share_count", "INTEGER DEFAULT 0")
            self._add_column_if_not_exists("comments", "ip_location", "TEXT")
            self._add_column_if_not_exists("comments", "rating", "REAL DEFAULT 0")

            # 创建帖子信息表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS posts (
                    id TEXT,
                    platform TEXT NOT NULL,
                    title TEXT,
                    content TEXT,
                    author_id TEXT,
                    author_name TEXT,
                    author_avatar TEXT,
                    url TEXT,
                    created_at TEXT,
                    like_count INTEGER DEFAULT 0,
                    comment_count INTEGER DEFAULT 0,
                    share_count INTEGER DEFAULT 0,
                    view_count INTEGER DEFAULT 0,
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (id, platform)
                )
            """)

            # 创建分析结果表 - 存储 AI 分析结果
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    comment_id TEXT NOT NULL,
                    platform TEXT NOT NULL DEFAULT 'twitter',
                    sentiment TEXT NOT NULL,
                    intent TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    model TEXT,
                    analyzed_at TEXT NOT NULL,
                    FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE
                )
            """)

            # 迁移旧表
            self._add_column_if_not_exists("analyses", "platform", "TEXT NOT NULL DEFAULT 'twitter'")

            # 创建索引以提升查询性能
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_comments_platform ON comments(platform)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_comments_post_platform ON comments(post_id, platform)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_analyses_sentiment ON analyses(sentiment)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_analyses_intent ON analyses(intent)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_analyses_platform ON analyses(platform)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform)")

            # 确保 analyses.comment_id 唯一
            try:
                cursor.execute("CREATE UNIQUE INDEX idx_analyses_comment_id ON analyses(comment_id)")
            except sqlite3.OperationalError:
                pass  # 索引已存在

            # ============ 回复功能相关表 ============

            # 产品/游戏配置表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    platform TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # 人设配置表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS personas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER,
                    name TEXT NOT NULL,
                    description TEXT,
                    system_prompt TEXT NOT NULL,
                    style_keywords TEXT,
                    is_active INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
                )
            """)

            # 回复模板表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS reply_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    persona_id INTEGER,
                    template_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    trigger_keywords TEXT,
                    priority INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE
                )
            """)

            # 待发布回复表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS generated_replies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    comment_id TEXT NOT NULL,
                    post_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    original_comment TEXT NOT NULL,
                    sentiment TEXT,
                    intent TEXT,
                    generated_reply TEXT NOT NULL,
                    persona_id INTEGER,
                    status TEXT DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    published_at TEXT,
                    FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE
                )
            """)

            # 回复发布日志表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS reply_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    comment_id TEXT NOT NULL,
                    post_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    reply_text TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error_message TEXT,
                    response_data TEXT,
                    created_at TEXT NOT NULL
                )
            """)

            # 设置表（存储全局设置）
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # 创建索引
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_personas_product ON personas(product_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_templates_persona ON reply_templates(persona_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_replies_status ON generated_replies(status)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_replies_post ON generated_replies(post_id, platform)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_logs_comment ON reply_logs(comment_id)")

            conn.commit()
        finally:
            conn.close()

    def _add_column_if_not_exists(self, table: str, column: str, column_def: str):
        """如果列不存在则添加"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_def}")
            conn.commit()
        except sqlite3.OperationalError:
            # 列已存在，忽略
            pass
        finally:
            conn.close()

    def insert_post(self, post: Dict) -> bool:
        """
        插入帖子信息

        Args:
            post: 帖子信息字典

        Returns:
            是否成功
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO posts
                (id, platform, title, content, author_id, author_name, author_avatar,
                 url, created_at, like_count, comment_count, share_count, view_count, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                post.get("id"),
                post.get("platform", "twitter"),
                post.get("title", ""),
                post.get("content", ""),
                post.get("author_id"),
                post.get("author_name"),
                post.get("author_avatar"),
                post.get("url"),
                post.get("created_at"),
                post.get("like_count", 0),
                post.get("comment_count", 0),
                post.get("share_count", 0),
                post.get("view_count", 0),
                datetime.utcnow().isoformat() + "Z"
            ))
            conn.commit()
            return True
        except sqlite3.Error as e:
            print(f"[数据库错误] 插入帖子信息失败: {e}")
            return False
        finally:
            conn.close()

    def get_post(self, post_id: str, platform: str) -> Optional[Dict]:
        """获取帖子信息"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT * FROM posts WHERE id = ? AND platform = ?
            """, (post_id, platform))

            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def insert_comment(self, comment: Dict) -> bool:
        """
        插入单条评论，如果已存在则更新

        Args:
            comment: 评论文档字典

        Returns:
            是否成功插入或更新
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO comments 
                (id, post_id, platform, author_id, author_username, author_name,
                 author_avatar, text, created_at, like_count, reply_count,
                 share_count, ip_location, source, rating, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                comment.get("id"),
                comment.get("post_id"),
                comment.get("platform", "twitter"),
                comment.get("author_id"),
                comment.get("author_username"),
                comment.get("author_name"),
                comment.get("author_avatar"),
                comment.get("text"),
                comment.get("created_at"),
                comment.get("like_count", 0),
                comment.get("reply_count", 0),
                comment.get("share_count", 0),
                comment.get("ip_location"),
                comment.get("source"),
                comment.get("rating", 0),
                datetime.utcnow().isoformat() + "Z"
            ))
            conn.commit()
            return True
        except sqlite3.Error as e:
            print(f"[数据库错误] 插入评论失败: {e}")
            return False
        finally:
            conn.close()

    def insert_comments_batch(self, comments: List[Dict]) -> int:
        """
        批量插入评论

        Args:
            comments: 评论列表

        Returns:
            成功插入的数量
        """
        count = 0
        for comment in comments:
            if self.insert_comment(comment):
                count += 1
        return count

    def get_comments_by_post(self, post_id: str, platform: Optional[str] = None, limit: Optional[int] = None) -> List[Dict]:
        """
        根据帖子 ID 获取评论

        Args:
            post_id: 帖子 ID
            platform: 可选，平台名称
            limit: 可选，限制返回数量

        Returns:
            评论列表
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = "SELECT * FROM comments WHERE post_id = ?"
            params = [post_id]

            if platform:
                query += " AND platform = ?"
                params.append(platform)

            query += " ORDER BY created_at DESC"

            if limit:
                query += " LIMIT ?"
                params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_unanalyzed_comments(self, post_id: Optional[str] = None, platform: Optional[str] = None, limit: Optional[int] = None) -> List[Dict]:
        """
        获取尚未分析的评论

        Args:
            post_id: 可选，指定帖子 ID
            platform: 可选，指定平台
            limit: 可选，限制返回数量

        Returns:
            未分析的评论列表
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = """
                SELECT c.* FROM comments c
                LEFT JOIN analyses a ON c.id = a.comment_id
                WHERE a.comment_id IS NULL
            """
            params = []

            if post_id:
                query += " AND c.post_id = ?"
                params.append(post_id)

            if platform:
                query += " AND c.platform = ?"
                params.append(platform)

            query += " ORDER BY c.created_at DESC"

            if limit:
                query += " LIMIT ?"
                params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def insert_analysis(self, analysis: Dict) -> bool:
        """
        插入分析结果

        Args:
            analysis: 分析结果字典

        Returns:
            是否成功
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO analyses 
                (comment_id, platform, sentiment, intent, summary, model, analyzed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                analysis.get("comment_id"),
                analysis.get("platform", "twitter"),
                analysis.get("sentiment"),
                analysis.get("intent"),
                analysis.get("summary"),
                analysis.get("model"),
                datetime.utcnow().isoformat() + "Z"
            ))
            conn.commit()
            return True
        except sqlite3.Error as e:
            print(f"[数据库错误] 插入分析结果失败: {e}")
            return False
        finally:
            conn.close()

    def insert_analyses_batch(self, analyses: List[Dict]) -> int:
        """
        批量插入分析结果

        Args:
            analyses: 分析结果列表

        Returns:
            成功插入的数量
        """
        count = 0
        for analysis in analyses:
            if self.insert_analysis(analysis):
                count += 1
        return count

    def get_comment_with_analysis(self, comment_id: str) -> Optional[Dict]:
        """
        获取单条评论及其分析结果

        Args:
            comment_id: 评论 ID

        Returns:
            包含分析结果的评论字典
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT c.*, a.sentiment, a.intent, a.summary, a.model, a.analyzed_at
                FROM comments c
                LEFT JOIN analyses a ON c.id = a.comment_id
                WHERE c.id = ?
            """, (comment_id,))

            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_all_comments_with_analysis(self, post_id: Optional[str] = None, platform: Optional[str] = None) -> List[Dict]:
        """
        获取所有评论及其分析结果

        Args:
            post_id: 可选，指定帖子 ID
            platform: 可选，指定平台

        Returns:
            包含分析结果的评论列表
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = """
                SELECT c.*, a.sentiment, a.intent, a.summary, a.model, a.analyzed_at
                FROM comments c
                LEFT JOIN analyses a ON c.id = a.comment_id
            """
            params = []
            conditions = []

            if post_id:
                conditions.append("c.post_id = ?")
                params.append(post_id)

            if platform:
                conditions.append("c.platform = ?")
                params.append(platform)

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " ORDER BY c.created_at DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_sentiment_stats(self, post_id: Optional[str] = None, platform: Optional[str] = None) -> Dict[str, int]:
        """
        获取情感分布统计

        Args:
            post_id: 可选，指定帖子 ID
            platform: 可选，指定平台

        Returns:
            各情感类型的计数
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = """
                SELECT a.sentiment, COUNT(*) as count
                FROM analyses a
                JOIN comments c ON a.comment_id = c.id
            """
            params = []
            conditions = []

            if post_id:
                conditions.append("c.post_id = ?")
                params.append(post_id)

            if platform:
                conditions.append("c.platform = ?")
                params.append(platform)

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " GROUP BY a.sentiment"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            return {row["sentiment"]: row["count"] for row in rows}
        finally:
            conn.close()

    def get_intent_stats(self, post_id: Optional[str] = None, platform: Optional[str] = None) -> Dict[str, int]:
        """
        获取意图分布统计

        Args:
            post_id: 可选，指定帖子 ID
            platform: 可选，指定平台

        Returns:
            各意图类型的计数
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = """
                SELECT a.intent, COUNT(*) as count
                FROM analyses a
                JOIN comments c ON a.comment_id = c.id
            """
            params = []
            conditions = []

            if post_id:
                conditions.append("c.post_id = ?")
                params.append(post_id)

            if platform:
                conditions.append("c.platform = ?")
                params.append(platform)

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " GROUP BY a.intent"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            return {row["intent"]: row["count"] for row in rows}
        finally:
            conn.close()

    def get_top_negative_comments(self, post_id: Optional[str] = None, platform: Optional[str] = None, limit: int = 5) -> List[Dict]:
        """
        获取最重要的负面评论（按点赞数排序）

        Args:
            post_id: 可选，指定帖子 ID
            platform: 可选，指定平台
            limit: 返回数量

        Returns:
            负面评论列表
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = """
                SELECT c.*, a.sentiment, a.intent, a.summary
                FROM comments c
                JOIN analyses a ON c.id = a.comment_id
                WHERE (a.sentiment = 'NEGATIVE' OR a.intent = 'COMPLAINT')
            """
            params = []

            if post_id:
                query += " AND c.post_id = ?"
                params.append(post_id)

            if platform:
                query += " AND c.platform = ?"
                params.append(platform)

            query += " ORDER BY c.like_count DESC, c.created_at DESC LIMIT ?"
            params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_total_count(self, post_id: Optional[str] = None, platform: Optional[str] = None) -> int:
        """
        获取评论总数

        Args:
            post_id: 可选，指定帖子 ID
            platform: 可选，指定平台

        Returns:
            评论总数
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = "SELECT COUNT(*) as count FROM comments"
            params = []
            conditions = []

            if post_id:
                conditions.append("post_id = ?")
                params.append(post_id)

            if platform:
                conditions.append("platform = ?")
                params.append(platform)

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            cursor.execute(query, params)
            row = cursor.fetchone()
            return row["count"] if row else 0
        finally:
            conn.close()

    def get_platforms(self) -> List[str]:
        """获取所有已存储的平台列表"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            cursor.execute("SELECT DISTINCT platform FROM comments ORDER BY platform")
            rows = cursor.fetchall()
            return [row["platform"] for row in rows]
        finally:
            conn.close()

    def get_posts(self, platform: Optional[str] = None) -> List[Dict]:
        """
        获取所有帖子

        Args:
            platform: 可选，指定平台

        Returns:
            帖子列表
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()

            query = "SELECT * FROM posts"
            params = []

            if platform:
                query += " WHERE platform = ?"
                params.append(platform)

            query += " ORDER BY fetched_at DESC"

            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    # ============ 回复功能相关方法 ============

    def get_setting(self, key: str, default: str = "") -> str:
        """获取设置"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
            row = cursor.fetchone()
            return row["value"] if row else default
        finally:
            conn.close()

    def set_setting(self, key: str, value: str) -> bool:
        """设置设置项"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
            """, (key, value, datetime.utcnow().isoformat() + "Z"))
            conn.commit()
            return True
        finally:
            conn.close()

    def get_all_products(self) -> List[Dict]:
        """获取所有产品"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM products ORDER BY created_at DESC")
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def insert_product(self, name: str, description: str = "", platform: str = "") -> int:
        """添加产品"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            now = datetime.utcnow().isoformat() + "Z"
            cursor.execute("""
                INSERT INTO products (name, description, platform, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            """, (name, description, platform, now, now))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def update_product(self, product_id: int, name: str, description: str = "") -> bool:
        """更新产品"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE products SET name = ?, description = ?, updated_at = ?
                WHERE id = ?
            """, (name, description, datetime.utcnow().isoformat() + "Z", product_id))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def delete_product(self, product_id: int) -> bool:
        """删除产品"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM products WHERE id = ?", (product_id,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def get_personas_by_product(self, product_id: int) -> List[Dict]:
        """获取产品的人设列表"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM personas WHERE product_id = ? ORDER BY is_active DESC, created_at DESC
            """, (product_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_active_persona(self, product_id: int) -> Optional[Dict]:
        """获取当前激活的人设"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM personas WHERE product_id = ? AND is_active = 1
            """, (product_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def insert_persona(self, product_id: int, name: str, system_prompt: str,
                     description: str = "", style_keywords: str = "") -> int:
        """添加人设"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            now = datetime.utcnow().isoformat() + "Z"
            cursor.execute("""
                INSERT INTO personas (product_id, name, description, system_prompt, style_keywords, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (product_id, name, description, system_prompt, style_keywords, now, now))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def update_persona(self, persona_id: int, name: str, system_prompt: str,
                      description: str = "", style_keywords: str = "") -> bool:
        """更新人设"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE personas SET name = ?, description = ?, system_prompt = ?,
                style_keywords = ?, updated_at = ?
                WHERE id = ?
            """, (name, description, system_prompt, style_keywords,
                  datetime.utcnow().isoformat() + "Z", persona_id))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def set_active_persona(self, persona_id: int, product_id: int) -> bool:
        """设置激活的人设"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            # 先取消所有激活状态
            cursor.execute("UPDATE personas SET is_active = 0 WHERE product_id = ?", (product_id,))
            # 激活指定人设
            cursor.execute("UPDATE personas SET is_active = 1 WHERE id = ?", (persona_id,))
            conn.commit()
            return True
        finally:
            conn.close()

    def delete_persona(self, persona_id: int) -> bool:
        """删除人设"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM personas WHERE id = ?", (persona_id,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def get_templates_by_persona(self, persona_id: int) -> List[Dict]:
        """获取人设的回复模板"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM reply_templates
                WHERE persona_id = ?
                ORDER BY priority DESC, created_at DESC
            """, (persona_id,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def insert_template(self, persona_id: int, template_type: str, content: str,
                      trigger_keywords: str = "", priority: int = 0) -> int:
        """添加回复模板"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            now = datetime.utcnow().isoformat() + "Z"
            cursor.execute("""
                INSERT INTO reply_templates (persona_id, template_type, content, trigger_keywords, priority, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (persona_id, template_type, content, trigger_keywords, priority, now, now))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def update_template(self, template_id: int, template_type: str, content: str,
                      trigger_keywords: str = "", priority: int = 0) -> bool:
        """更新回复模板"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE reply_templates SET template_type = ?, content = ?,
                trigger_keywords = ?, priority = ?, updated_at = ?
                WHERE id = ?
            """, (template_type, content, trigger_keywords, priority,
                  datetime.utcnow().isoformat() + "Z", template_id))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def delete_template(self, template_id: int) -> bool:
        """删除回复模板"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM reply_templates WHERE id = ?", (template_id,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def insert_generated_reply(self, comment_id: str, post_id: str, platform: str,
                              original_comment: str, sentiment: str, intent: str,
                              generated_reply: str, persona_id: int = None) -> int:
        """保存生成的回复"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO generated_replies (comment_id, post_id, platform, original_comment,
                sentiment, intent, generated_reply, persona_id, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """, (comment_id, post_id, platform, original_comment, sentiment, intent,
                  generated_reply, persona_id, datetime.utcnow().isoformat() + "Z"))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_pending_replies(self, post_id: str = None, platform: str = None) -> List[Dict]:
        """获取待发布的回复"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            query = "SELECT * FROM generated_replies WHERE status = 'pending'"
            params = []
            if post_id:
                query += " AND post_id = ?"
                params.append(post_id)
            if platform:
                query += " AND platform = ?"
                params.append(platform)
            query += " ORDER BY created_at DESC"
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def update_reply_status(self, reply_id: int, status: str, published_at: str = None) -> bool:
        """更新回复状态"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            if published_at:
                cursor.execute("""
                    UPDATE generated_replies SET status = ?, published_at = ? WHERE id = ?
                """, (status, published_at, reply_id))
            else:
                cursor.execute("""
                    UPDATE generated_replies SET status = ? WHERE id = ?
                """, (status, reply_id))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def insert_reply_log(self, comment_id: str, post_id: str, platform: str,
                        reply_text: str, status: str, error_message: str = "",
                        response_data: str = "") -> int:
        """记录回复日志"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO reply_logs (comment_id, post_id, platform, reply_text, status, error_message, response_data, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (comment_id, post_id, platform, reply_text, status, error_message, response_data,
                  datetime.utcnow().isoformat() + "Z"))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_reply_logs(self, limit: int = 100) -> List[Dict]:
        """获取回复日志"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM reply_logs ORDER BY created_at DESC LIMIT ?
            """, (limit,))
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def get_reply_stats(self, post_id: str = None, platform: str = None) -> Dict:
        """获取回复统计"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            query = "SELECT status, COUNT(*) as count FROM generated_replies WHERE 1=1"
            params = []
            if post_id:
                query += " AND post_id = ?"
                params.append(post_id)
            if platform:
                query += " AND platform = ?"
                params.append(platform)
            query += " GROUP BY status"
            cursor.execute(query, params)
            rows = cursor.fetchall()
            return {row["status"]: row["count"] for row in rows}
        finally:
            conn.close()

    def close(self) -> None:
        """关闭数据库连接（保留以兼容旧代码）"""
        pass

    def __enter__(self):
        """上下文管理器入口"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        pass
