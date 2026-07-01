"""
报告生成模块
从数据库中读取评论和分析数据，生成结构化的 Markdown 格式报告。
报告包含：总评论数、情感分布、意图分布、前 5 条最重要的负面评论。
"""

import os
from datetime import datetime
from typing import Optional, Dict, List


class ReportGenerator:
    """Markdown 报告生成器"""

    def __init__(self, report_dir: str = "reports"):
        """
        初始化报告生成器

        Args:
            report_dir: 报告输出目录
        """
        self.report_dir = report_dir
        self._ensure_report_dir()

    def _ensure_report_dir(self) -> None:
        """确保报告目录存在"""
        if not os.path.exists(self.report_dir):
            os.makedirs(self.report_dir)
            print(f"[报告生成] 创建报告目录: {self.report_dir}")

    def generate_report(
        self,
        db,
        post_id: str,
        platform: str = "twitter",
        post_info: Optional[Dict] = None,
        tweet_info: Optional[Dict] = None,
        output_filename: Optional[str] = None,
        ai_analyzer=None
    ) -> str:
        """
        生成完整的分析报告

        Args:
            db: Database 实例
            post_id: 帖子 ID
            platform: 平台名称
            post_info: 帖子基本信息（新格式，推荐）
            tweet_info: 推文基本信息（旧格式，兼容保留）
            output_filename: 输出文件名（可选，自动生成则为 None）
            ai_analyzer: AI 分析器实例（可选，用于深度分析）

        Returns:
            生成的报告文件路径
        """
        print("[报告生成] 开始生成分析报告...")

        # 兼容旧参数
        if post_info is None and tweet_info is not None:
            post_info = {
                "id": tweet_info.get("id", ""),
                "title": "",
                "content": tweet_info.get("text", ""),
                "author_id": tweet_info.get("author_id", ""),
                "author_name": tweet_info.get("author_name", ""),
                "author_username": tweet_info.get("author_username", ""),
                "created_at": tweet_info.get("created_at", ""),
                "like_count": tweet_info.get("like_count", 0),
                "comment_count": tweet_info.get("reply_count", 0),
                "share_count": tweet_info.get("retweet_count", 0),
                "view_count": 0,
                "url": f"https://twitter.com/i/web/status/{tweet_info.get('id', '')}",
                "platform": "twitter",
            }

        # 平台显示名称
        platform_names = {
            "twitter": "Twitter / X",
            "bilibili": "哔哩哔哩 (B站)",
            "xiaohongshu": "小红书",
            "weibo": "微博",
            "douyin": "抖音",
        }
        platform_display = platform_names.get(platform, platform)

        # 获取统计数据
        total_count = db.get_total_count(post_id, platform)
        sentiment_stats = db.get_sentiment_stats(post_id, platform)
        intent_stats = db.get_intent_stats(post_id, platform)
        top_negative = db.get_top_negative_comments(post_id, platform, limit=5)

        # AI 深度分析（如果提供了 ai_analyzer）
        deep_insights = None
        if ai_analyzer:
            print("[报告生成] 进行AI深度分析...")
            all_comments = db.get_all_comments_with_analysis(post_id, platform)
            if all_comments:
                deep_insights = ai_analyzer.analyze_deep_insights(all_comments, platform)
            else:
                print("[报告生成] 暂无分析数据，跳过深度分析")

        # 构建报告内容
        report_lines = []

        # 标题
        report_lines.append(f"# AI回复总结评论 - 分析报告 ({platform_display})")
        report_lines.append("")

        # 生成时间
        report_lines.append(f"**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        report_lines.append(f"**分析平台**: {platform_display}")
        report_lines.append("")

        # 帖子信息
        if post_info:
            item_label = "帖子" if platform in ["weibo", "xiaohongshu"] else ("视频" if platform in ["bilibili", "douyin"] else "推文")
            report_lines.append(f"## 📌 {item_label}信息")
            report_lines.append("")
            report_lines.append(f"- **ID**: {post_info.get('id', 'N/A')}")
            if post_info.get('author_name'):
                author_str = post_info['author_name']
                if post_info.get('author_username') and post_info['author_username'] != post_info['author_name']:
                    author_str += f" (@{post_info['author_username']})"
                report_lines.append(f"- **作者**: {author_str}")
            if post_info.get('created_at'):
                report_lines.append(f"- **发布时间**: {post_info.get('created_at', 'N/A')}")
            if post_info.get('view_count'):
                report_lines.append(f"- **浏览数**: {post_info.get('view_count', 0):,}")
            report_lines.append(f"- **点赞数**: {post_info.get('like_count', 0):,}")
            report_lines.append(f"- **评论数**: {post_info.get('comment_count', 0):,}")
            report_lines.append(f"- **分享数**: {post_info.get('share_count', 0):,}")
            report_lines.append("")

            if post_info.get('title'):
                report_lines.append(f"**标题**: {post_info.get('title', 'N/A')}")
                report_lines.append("")
            if post_info.get('content'):
                report_lines.append(f"**内容**:")
                report_lines.append("")
                report_lines.append(f"> {post_info.get('content', 'N/A')}")
                report_lines.append("")
            if post_info.get('url'):
                report_lines.append(f"[🔗 查看原帖]({post_info.get('url')})")
                report_lines.append("")

        # 总览
        report_lines.append("## 📊 总览")
        report_lines.append("")
        report_lines.append(f"**总评论数**: {total_count:,}")
        report_lines.append("")

        # 情感分布
        report_lines.append("## 💭 情感分布")
        report_lines.append("")

        if sentiment_stats:
            total_analyzed = sum(sentiment_stats.values())

            # 表格
            report_lines.append("| 情感类型 | 数量 | 占比 |")
            report_lines.append("|---------|------|------|")

            sentiment_labels = {
                "POSITIVE": "😊 正面 (Positive)",
                "NEUTRAL": "😐 中性 (Neutral)",
                "NEGATIVE": "😠 负面 (Negative)"
            }

            # 按数量排序
            sorted_sentiments = sorted(
                sentiment_stats.items(),
                key=lambda x: x[1],
                reverse=True
            )

            for sentiment, count in sorted_sentiments:
                label = sentiment_labels.get(sentiment, sentiment)
                percentage = (count / total_analyzed * 100) if total_analyzed > 0 else 0
                report_lines.append(f"| {label} | {count:,} | {percentage:.1f}% |")

            report_lines.append("")
            report_lines.append(f"*已分析评论数: {total_analyzed:,}*")
            report_lines.append("")
        else:
            report_lines.append("暂无情感分析数据")
            report_lines.append("")

        # 意图分布
        report_lines.append("## 🎯 意图分布")
        report_lines.append("")

        if intent_stats:
            total_analyzed = sum(intent_stats.values())

            report_lines.append("| 意图类型 | 数量 | 占比 |")
            report_lines.append("|---------|------|------|")

            intent_labels = {
                "INQUIRY": "❓ 咨询提问 (Inquiry)",
                "FEEDBACK": "💬 反馈建议 (Feedback)",
                "COMPLAINT": "⚠️ 投诉抱怨 (Complaint)",
                "SPAM": "🚫 垃圾广告 (Spam)",
                "OTHER": "📝 其他 (Other)"
            }

            # 按数量排序
            sorted_intents = sorted(
                intent_stats.items(),
                key=lambda x: x[1],
                reverse=True
            )

            for intent, count in sorted_intents:
                label = intent_labels.get(intent, intent)
                percentage = (count / total_analyzed * 100) if total_analyzed > 0 else 0
                report_lines.append(f"| {label} | {count:,} | {percentage:.1f}% |")

            report_lines.append("")
            report_lines.append(f"*已分析评论数: {total_analyzed:,}*")
            report_lines.append("")
        else:
            report_lines.append("暂无意图分析数据")
            report_lines.append("")

        # ============= 深度分析章节 =============

        # 1. 用户反馈痛点
        report_lines.append("## 🎯 用户反馈痛点")
        report_lines.append("")

        if deep_insights and deep_insights.get("pain_points"):
            pain_points = deep_insights["pain_points"]
            report_lines.append(f"共识别出 **{len(pain_points)}** 个主要用户痛点：")
            report_lines.append("")

            for i, pp in enumerate(pain_points, 1):
                severity = pp.get("severity", 3)
                severity_stars = "⭐" * severity
                count = pp.get("count", "?")
                title = pp.get("title", f"痛点 {i}")
                description = pp.get("description", "")
                example = pp.get("example", "")

                report_lines.append(f"### {i}. {title}")
                report_lines.append("")
                report_lines.append(f"- **严重程度**: {severity_stars} ({severity}/5)")
                report_lines.append(f"- **提及频次**: 约 {count} 次")
                report_lines.append("")
                report_lines.append(f"**问题描述**:")
                report_lines.append("")
                report_lines.append(f"> {description}")
                report_lines.append("")
                if example:
                    report_lines.append(f"**典型评论**:")
                    report_lines.append("")
                    report_lines.append(f"> \"{example}\"")
                    report_lines.append("")
        else:
            report_lines.append("*暂无深度分析数据，请先进行 AI 分析*")
            report_lines.append("")

        # 2. Bug反馈
        report_lines.append("## 🐛 Bug 反馈")
        report_lines.append("")

        if deep_insights and deep_insights.get("bug_reports"):
            bug_reports = deep_insights["bug_reports"]
            report_lines.append(f"共识别出 **{len(bug_reports)}** 个 Bug/技术问题：")
            report_lines.append("")

            for i, bug in enumerate(bug_reports, 1):
                severity = bug.get("severity", 3)
                severity_stars = "⭐" * severity
                count = bug.get("count", "?")
                title = bug.get("title", f"Bug {i}")
                description = bug.get("description", "")
                steps = bug.get("steps", "")
                example = bug.get("example", "")

                report_lines.append(f"### {i}. {title}")
                report_lines.append("")
                report_lines.append(f"- **严重程度**: {severity_stars} ({severity}/5)")
                report_lines.append(f"- **影响范围**: 约 {count} 次提及")
                report_lines.append("")
                report_lines.append(f"**Bug描述**:")
                report_lines.append("")
                report_lines.append(f"> {description}")
                report_lines.append("")
                if steps:
                    report_lines.append(f"**现象/重现**: {steps}")
                    report_lines.append("")
                if example:
                    report_lines.append(f"**典型反馈**:")
                    report_lines.append("")
                    report_lines.append(f"> \"{example}\"")
                    report_lines.append("")
        else:
            report_lines.append("*暂无深度分析数据*")
            report_lines.append("")

        # 3. 改进建议
        report_lines.append("## 💡 改进建议")
        report_lines.append("")

        if deep_insights and deep_insights.get("improvement_suggestions"):
            suggestions = deep_insights["improvement_suggestions"]
            report_lines.append(f"共收集 **{len(suggestions)}** 条有价值的改进建议：")
            report_lines.append("")

            for i, sug in enumerate(suggestions, 1):
                value = sug.get("value", 3)
                feasibility = sug.get("feasibility", 3)
                value_stars = "⭐" * value
                feasibility_stars = "⭐" * feasibility
                title = sug.get("title", f"建议 {i}")
                description = sug.get("description", "")
                example = sug.get("example", "")

                report_lines.append(f"### {i}. {title}")
                report_lines.append("")
                report_lines.append(f"- **价值评估**: {value_stars} ({value}/5)")
                report_lines.append(f"- **可行性**: {feasibility_stars} ({feasibility}/5)")
                report_lines.append("")
                report_lines.append(f"**建议内容**:")
                report_lines.append("")
                report_lines.append(f"> {description}")
                report_lines.append("")
                if example:
                    report_lines.append(f"**用户原话**:")
                    report_lines.append("")
                    report_lines.append(f"> \"{example}\"")
                    report_lines.append("")
        else:
            report_lines.append("*暂无深度分析数据*")
            report_lines.append("")

        # 4. 问题优先级排序
        report_lines.append("## 📋 问题优先级排序")
        report_lines.append("")

        if deep_insights and deep_insights.get("priority_ranking"):
            rankings = deep_insights["priority_ranking"]
            report_lines.append("综合影响范围、严重程度和用户诉求，问题优先级从高到低排序：")
            report_lines.append("")

            # 表格形式
            report_lines.append("| 优先级 | 问题 | 分类 | 紧急程度 | 排序理由 |")
            report_lines.append("|--------|------|------|----------|----------|")

            for item in rankings:
                rank = item.get("rank", "?")
                issue = item.get("issue", "")
                category = item.get("category", "")
                urgency = item.get("urgency", 3)
                reason = item.get("reason", "")

                category_icon = {
                    "痛点": "🎯",
                    "Bug": "🐛",
                    "建议": "💡",
                    "bug": "🐛",
                    "pain_point": "🎯",
                    "improvement": "💡",
                }.get(category, "📌")

                urgency_fire = "🔥" * urgency

                report_lines.append(f"| P{rank} | {category_icon} {issue} | {category} | {urgency_fire} ({urgency}/5) | {reason} |")

            report_lines.append("")
        else:
            report_lines.append("*暂无深度分析数据*")
            report_lines.append("")

        # ============= 原有章节 =============

        # 重要负面评论
        report_lines.append("## ⚠️ 重要负面评论 / 投诉")
        report_lines.append("")

        if top_negative:
            for i, comment in enumerate(top_negative, 1):
                report_lines.append(f"### {i}. 评论 #{comment['id']}")
                report_lines.append("")

                # 作者信息
                author = f"@{comment.get('author_username', 'unknown')}"
                if comment.get("author_name"):
                    author = f"{comment['author_name']} ({author})"
                report_lines.append(f"- **作者**: {author}")
                report_lines.append(f"- **发布时间**: {comment.get('created_at', 'N/A')}")
                report_lines.append(f"- **点赞数**: {comment.get('like_count', 0):,}")
                report_lines.append(f"- **情感**: {comment.get('sentiment', 'N/A')}")
                report_lines.append(f"- **意图**: {comment.get('intent', 'N/A')}")
                report_lines.append(f"- **摘要**: {comment.get('summary', 'N/A')}")
                report_lines.append("")
                report_lines.append("**评论内容**:")
                report_lines.append("")
                report_lines.append(f"> {comment.get('text', 'N/A')}")
                report_lines.append("")
        else:
            report_lines.append("暂无负面评论或投诉 🎉")
            report_lines.append("")

        # 页脚
        report_lines.append("---")
        report_lines.append("")
        report_lines.append("*由 AI回复总结评论 智能体自动生成*")
        report_lines.append("")

        # 拼接报告内容
        report_content = "\n".join(report_lines)

        # 生成文件名
        if not output_filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_filename = f"report_{post_id}_{timestamp}.md"

        # 写入文件
        output_path = os.path.join(self.report_dir, output_filename)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(report_content)

        print(f"[报告生成] 报告已保存至: {output_path}")
        return output_path

    def generate_summary_text(self, db, post_id: str, platform: str = "twitter") -> str:
        """
        生成简短的文本摘要（用于控制台输出）

        Args:
            db: Database 实例
            post_id: 帖子 ID
            platform: 平台名称

        Returns:
            摘要文本
        """
        total_count = db.get_total_count(post_id, platform)
        sentiment_stats = db.get_sentiment_stats(post_id, platform)
        intent_stats = db.get_intent_stats(post_id, platform)

        lines = []
        lines.append("=" * 50)
        lines.append("  评论分析摘要")
        lines.append("=" * 50)
        lines.append(f"  总评论数: {total_count:,}")
        lines.append("")

        if sentiment_stats:
            total = sum(sentiment_stats.values())
            lines.append("  情感分布:")
            for sentiment in ["POSITIVE", "NEUTRAL", "NEGATIVE"]:
                count = sentiment_stats.get(sentiment, 0)
                pct = (count / total * 100) if total > 0 else 0
                lines.append(f"    {sentiment:10s}: {count:5d} ({pct:5.1f}%)")
            lines.append("")

        if intent_stats:
            total = sum(intent_stats.values())
            lines.append("  意图分布:")
            for intent in ["INQUIRY", "FEEDBACK", "COMPLAINT", "SPAM", "OTHER"]:
                count = intent_stats.get(intent, 0)
                pct = (count / total * 100) if total > 0 else 0
                lines.append(f"    {intent:10s}: {count:5d} ({pct:5.1f}%)")
            lines.append("")

        lines.append("=" * 50)

        return "\n".join(lines)
