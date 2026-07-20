"""
回复管理器
负责评论筛选、AI回复生成、回复发布等核心逻辑
"""

import re
import time
import json
from typing import List, Dict, Optional, Tuple
from datetime import datetime


# B站回复间隔（秒）
BILIBILI_REPLY_INTERVAL = 60


class ReplyManager:
    """回复管理器"""

    # Bug 相关关键词
    BUG_KEYWORDS = [
        "bug", "错误", "闪退", "卡顿", "崩溃", "死机", "黑屏",
        "掉线", "延迟", "掉帧", "卡死", "白屏", "花屏", "无响应",
        "进不去", "打不开", "玩不了", "不能玩", "进游戏", "登录不了",
        "进不去", "bug", "报错", "异常", "问题", "坏了"
    ]

    def __init__(self, db, ai_analyzer=None):
        """
        初始化回复管理器

        Args:
            db: Database 实例
            ai_analyzer: AIAnalyzer 实例（可选）
        """
        self.db = db
        self.ai_analyzer = ai_analyzer

    def should_reply(self, comment: Dict, post_like_count: int = 0, threshold_percent: float = 3.0) -> Tuple[bool, str]:
        """
        判断是否需要回复

        Args:
            comment: 评论数据
            post_like_count: 帖子总点赞数
            threshold_percent: 点赞阈值百分比

        Returns:
            (是否需要回复, 原因)
        """
        text = comment.get("text", "").lower()
        like_count = comment.get("like_count", 0)
        intent = comment.get("intent", "")
        sentiment = comment.get("sentiment", "")

        # 1. 检查 Bug 关键词（无条件回复）
        for keyword in self.BUG_KEYWORDS:
            if keyword.lower() in text:
                return True, f"检测到Bug关键词: {keyword}"

        # 2. 检查意图
        reply_intents = ["INQUIRY", "COMPLAINT", "NEGATIVE"]
        if intent in reply_intents:
            # 3. 检查点赞阈值
            if post_like_count > 0:
                threshold = post_like_count * (threshold_percent / 100)
                if like_count >= threshold:
                    return True, f"点赞数 {like_count} >= 阈值 {threshold:.0f}"
                else:
                    return False, f"点赞数未达阈值 ({like_count}/{threshold:.0f})"
            else:
                # 没有总点赞数据时，只回复点赞 >= 3 的
                if like_count >= 3:
                    return True, f"点赞数 {like_count} >= 3"
                else:
                    return False, f"点赞数过低 ({like_count})"

        return False, "不满足回复条件"

    def filter_comments_for_reply(self, comments: List[Dict], post_like_count: int = 0,
                                   threshold_percent: float = 3.0) -> List[Dict]:
        """
        筛选需要回复的评论

        Args:
            comments: 评论列表
            post_like_count: 帖子总点赞数
            threshold_percent: 点赞阈值百分比

        Returns:
            需要回复的评论列表
        """
        result = []
        for comment in comments:
            should, reason = self.should_reply(comment, post_like_count, threshold_percent)
            if should:
                comment["_reply_reason"] = reason
                result.append(comment)
        return result

    def generate_reply_with_ai(self, comment: Dict, persona: Dict, templates: List[Dict],
                              platform: str) -> str:
        """
        使用 AI 生成回复

        Args:
            comment: 评论数据
            persona: 人设配置
            templates: 回复模板列表
            platform: 平台名称

        Returns:
            生成的回复内容
        """
        if not self.ai_analyzer:
            return self._generate_reply_from_template(comment, templates)

        # 平台风格提示
        platform_styles = {
            "twitter": "正式、专业",
            "bilibili": "亲切、活泼、可以玩梗",
            "xiaohongshu": "种草风、亲切、带有emoji",
            "weibo": "正式、友好",
            "douyin": "轻松、有趣"
        }
        platform_style = platform_styles.get(platform, "亲切、友好")

        # 构建提示词
        system_prompt = persona.get("system_prompt", "")
        style_keywords = persona.get("style_keywords", "")
        intent = comment.get("intent", "")
        sentiment = comment.get("sentiment", "")
        comment_text = comment.get("text", "")

        # 选择合适的模板
        template_content = self._select_template(templates, comment)

        prompt = f"""你是一个{persona.get('name', '官方客服')}，需要回复用户的评论。

## 人设信息
{system_prompt}

## 风格关键词
{style_keywords}

## {platform}平台风格
{platform_style}

## 评论信息
- 评论内容: {comment_text}
- 评论意图: {intent}
- 情感倾向: {sentiment}

## 回复模板参考
{template_content}

## 要求
1. 根据评论内容和人设生成合适的回复
2. 回复要自然、友好，不能太长（50字以内）
3. 回复要有针对性，不能是万能回复
4. 可以适当使用表情，但不要过度
5. 保持人设风格一致

请生成回复内容（只输出回复文字，不要其他内容）："""

        try:
            response = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": "请生成回复"}
                ],
                max_tokens=100,
                temperature=0.7
            )
            reply = response.choices[0].message.content.strip()
            # 去除可能的引号
            reply = reply.strip('"').strip("'")
            return reply
        except Exception as e:
            print(f"[AI回复生成失败] {e}")
            return self._generate_reply_from_template(comment, templates)

    def _select_template(self, templates: List[Dict], comment: Dict) -> str:
        """根据评论选择合适的模板"""
        if not templates:
            return ""

        text = comment.get("text", "").lower()
        intent = comment.get("intent", "")

        # 按优先级匹配模板
        for template in sorted(templates, key=lambda x: x.get("priority", 0), reverse=True):
            keywords = template.get("trigger_keywords", "")
            template_type = template.get("template_type", "")

            # 检查关键词匹配
            if keywords:
                keyword_list = [k.strip().lower() for k in keywords.split(",")]
                for keyword in keyword_list:
                    if keyword and keyword in text:
                        return f"[{template_type}模板]\n{template.get('content', '')}"

            # 检查意图匹配
            type_intent_map = {
                "问候": "OTHER",
                "Bug": "COMPLAINT",
                "建议": "FEEDBACK",
                "疑问": "INQUIRY",
                "负面": "NEGATIVE",
                "投诉": "COMPLAINT"
            }
            if type_intent_map.get(template_type) == intent:
                return f"[{template_type}模板]\n{template.get('content', '')}"

        # 返回默认模板
        for template in templates:
            if template.get("template_type") == "通用":
                return template.get("content", "")

        return templates[0].get("content", "") if templates else ""

    def _generate_reply_from_template(self, comment: Dict, templates: List[Dict]) -> str:
        """使用模板生成回复"""
        template_content = self._select_template(templates, comment)
        if template_content:
            return template_content
        return "感谢您的反馈，我们会认真处理！"

    def generate_batch_replies(self, comments: List[Dict], persona: Dict,
                              templates: List[Dict], platform: str,
                              progress_callback=None) -> List[Dict]:
        """
        批量生成回复

        Args:
            comments: 评论列表
            persona: 人设配置
            templates: 回复模板列表
            platform: 平台名称
            progress_callback: 进度回调函数

        Returns:
            生成的回复列表
        """
        replies = []
        total = len(comments)

        for i, comment in enumerate(comments):
            reply_text = self.generate_reply_with_ai(comment, persona, templates, platform)
            replies.append({
                "comment_id": comment.get("id"),
                "post_id": comment.get("post_id"),
                "platform": platform,
                "original_comment": comment.get("text", ""),
                "sentiment": comment.get("sentiment", ""),
                "intent": comment.get("intent", ""),
                "generated_reply": reply_text,
                "persona_id": persona.get("id"),
                "like_count": comment.get("like_count", 0),
                "reason": comment.get("_reply_reason", "")
            })

            if progress_callback:
                progress_callback(i + 1, total)

        return replies

    def save_replies(self, replies: List[Dict]) -> int:
        """
        保存生成的回复到数据库

        Args:
            replies: 回复列表

        Returns:
            保存的数量
        """
        count = 0
        for reply in replies:
            try:
                self.db.insert_generated_reply(
                    comment_id=reply["comment_id"],
                    post_id=reply["post_id"],
                    platform=reply["platform"],
                    original_comment=reply["original_comment"],
                    sentiment=reply["sentiment"],
                    intent=reply["intent"],
                    generated_reply=reply["generated_reply"],
                    persona_id=reply.get("persona_id")
                )
                count += 1
            except Exception as e:
                print(f"[保存回复失败] {e}")
        return count

    def get_pending_replies(self, post_id: str = None, platform: str = None) -> List[Dict]:
        """获取待发布的回复"""
        return self.db.get_pending_replies(post_id, platform)

    def publish_reply(self, reply: Dict, collector) -> Tuple[bool, str]:
        """
        发布单条回复

        Args:
            reply: 回复数据
            collector: 平台收集器（需要有 reply_comment 方法）

        Returns:
            (是否成功, 消息)
        """
        try:
            # 调用平台 API 发布回复
            platform = reply.get("platform", "")
            post_id = reply.get("post_id", "")

            # 根据平台传递不同参数
            if platform == "bilibili":
                result = collector.reply_comment(
                    reply["comment_id"],
                    reply["generated_reply"],
                    bvid=post_id
                )
            else:
                result = collector.reply_comment(
                    reply["comment_id"],
                    reply["generated_reply"]
                )

            if result.get("success"):
                self.db.update_reply_status(
                    reply["id"],
                    "published",
                    datetime.utcnow().isoformat() + "Z"
                )
                self.db.insert_reply_log(
                    comment_id=reply["comment_id"],
                    post_id=reply["post_id"],
                    platform=reply["platform"],
                    reply_text=reply["generated_reply"],
                    status="success",
                    response_data=json.dumps(result, ensure_ascii=False)
                )
                return True, "发布成功"
            else:
                self.db.insert_reply_log(
                    comment_id=reply["comment_id"],
                    post_id=reply["post_id"],
                    platform=reply["platform"],
                    reply_text=reply["generated_reply"],
                    status="failed",
                    error_message=str(result.get("error", "未知错误"))
                )
                return False, result.get("error", "发布失败")

        except Exception as e:
            self.db.insert_reply_log(
                comment_id=reply["comment_id"],
                post_id=reply["post_id"],
                platform=reply["platform"],
                reply_text=reply["generated_reply"],
                status="error",
                error_message=str(e)
            )
            return False, str(e)

    def publish_batch_replies(self, replies: List[Dict], collector,
                            platform: str, interval: int = 60,
                            progress_callback=None) -> Dict:
        """
        批量发布回复

        Args:
            replies: 回复列表
            collector: 平台收集器
            platform: 平台名称
            interval: 发布间隔（秒）
            progress_callback: 进度回调函数

        Returns:
            发布结果统计
        """
        results = {"success": 0, "failed": 0, "errors": []}
        total = len(replies)

        for i, reply in enumerate(replies):
            success, msg = self.publish_reply(reply, collector)
            if success:
                results["success"] += 1
            else:
                results["failed"] += 1
                results["errors"].append({
                    "comment_id": reply["comment_id"],
                    "error": msg
                })

            if progress_callback:
                progress_callback(i + 1, total)

            # 发布间隔
            if i < total - 1:
                time.sleep(interval)

        return results

    def get_reply_logs(self, limit: int = 100) -> List[Dict]:
        """获取回复日志"""
        return self.db.get_reply_logs(limit)

    def get_reply_stats(self, post_id: str = None, platform: str = None) -> Dict:
        """获取回复统计"""
        return self.db.get_reply_stats(post_id, platform)
