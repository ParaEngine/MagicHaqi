"""
AI回复总结评论 - 交互式命令行界面
提供菜单式交互，用户可以逐步使用各项功能
"""

import os
import sys
from dotenv import load_dotenv

from database import Database
from twitter_collector import TwitterCollector
from ai_analyzer import AIAnalyzer
from report_generator import ReportGenerator


class CLI:
    """命令行交互界面"""

    def __init__(self):
        self.config = {}
        self.db = None
        self.twitter = None
        self.ai_analyzer = None
        self.report_gen = None
        self.tweet_info = None
        self.current_post_id = None

    def clear_screen(self):
        """清屏"""
        os.system('cls' if os.name == 'nt' else 'clear')

    def print_header(self):
        """打印标题"""
        print()
        print("=" * 60)
        print("        AI回复总结评论")
        print("=" * 60)
        print()

    def print_menu(self):
        """打印主菜单"""
        print("请选择操作：")
        print()
        print("  [1] 📋 检查配置")
        print("  [2] 🐦 拉取 Twitter 评论")
        print("  [3] 🤖 AI 分析评论")
        print("  [4] 📊 生成分析报告")
        print("  [5] 📁 查看历史报告")
        print("  [6] 💾 查看数据库状态")
        print("  [0] 🚪 退出")
        print()

    def load_config(self) -> bool:
        """加载配置"""
        print("[加载配置] 正在读取 .env 文件...")

        if not os.path.exists(".env"):
            print("❌ 未找到 .env 文件，请先创建并配置环境变量")
            print("   参考 .env.example 文件")
            return False

        load_dotenv()

        self.config = {
            "twitter_bearer_token": os.getenv("TWITTER_BEARER_TOKEN", ""),
            "post_id": os.getenv("POST_ID", ""),
            "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
            "openai_base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            "openai_model": os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"),
            "db_path": os.getenv("DB_PATH", "socialecho.db"),
            "report_dir": os.getenv("REPORT_DIR", "reports"),
        }

        # 验证必填项
        missing = []
        if not self.config["twitter_bearer_token"]:
            missing.append("TWITTER_BEARER_TOKEN")
        if not self.config["openai_api_key"]:
            missing.append("OPENAI_API_KEY")

        if missing:
            print(f"❌ 缺少必要的配置项: {', '.join(missing)}")
            return False

        print("✅ 配置加载成功")
        return True

    def check_config(self):
        """检查配置状态"""
        self.clear_screen()
        self.print_header()

        print("[配置检查]")
        print()

        if not self.load_config():
            print()
            input("按回车键继续...")
            return

        print()
        print("当前配置：")
        print()
        print(f"  Twitter Bearer Token: {'✅ 已配置' if self.config['twitter_bearer_token'] else '❌ 未配置'}")
        print(f"  OpenAI API Key:      {'✅ 已配置' if self.config['openai_api_key'] else '❌ 未配置'}")
        print(f"  OpenAI Base URL:     {self.config['openai_base_url']}")
        print(f"  OpenAI Model:        {self.config['openai_model']}")
        print(f"  数据库路径:           {self.config['db_path']}")
        print(f"  报告目录:             {self.config['report_dir']}")
        print()

        post_id = self.config.get("post_id", "")
        if post_id:
            print(f"  目标帖子 ID:         {post_id}")
        else:
            print("  目标帖子 ID:         ⚠️ 未配置（可在 .env 中设置 POST_ID）")
        print()

        input("按回车键继续...")

    def ensure_modules(self) -> bool:
        """确保所有模块已初始化"""
        if not self.config:
            if not self.load_config():
                return False

        if self.db is None:
            self.db = Database(self.config["db_path"])

        if self.twitter is None:
            self.twitter = TwitterCollector(self.config["twitter_bearer_token"])

        if self.ai_analyzer is None:
            self.ai_analyzer = AIAnalyzer(
                api_key=self.config["openai_api_key"],
                base_url=self.config["openai_base_url"],
                model=self.config["openai_model"]
            )

        if self.report_gen is None:
            self.report_gen = ReportGenerator(self.config["report_dir"])

        return True

    def fetch_comments(self):
        """拉取评论"""
        self.clear_screen()
        self.print_header()

        if not self.ensure_modules():
            input("按回车键继续...")
            return

        # 获取帖子 ID
        post_id = self.config.get("post_id", "")
        if not post_id:
            print("[拉取评论] 请输入帖子 ID（或在 .env 中设置 POST_ID）:")
            post_id = input("  > ").strip()
            if not post_id:
                print("❌ 未提供帖子 ID")
                input("按回车键继续...")
                return

        self.current_post_id = post_id

        print()
        print(f"[拉取评论] 正在获取帖子 {post_id} 的评论...")
        print()

        # 获取推文信息
        self.tweet_info = self.twitter.get_tweet_info(post_id)
        if self.tweet_info:
            print(f"  推文作者: @{self.tweet_info.get('author_username', 'unknown')}")
            text_preview = self.tweet_info.get('text', '')[:80]
            print(f"  推文预览: {text_preview}...")
        else:
            print("  ⚠️ 无法获取推文信息，可能帖子不存在或 API 权限不足")

        print()

        # 询问最大数量
        print("请输入最大拉取数量（直接回车默认为 100）:")
        max_input = input("  > ").strip()
        max_comments = int(max_input) if max_input.isdigit() else 100

        print()
        print(f"正在拉取评论（最多 {max_comments} 条）...")
        print()

        # 拉取评论
        comments = self.twitter.fetch_comments(post_id, max_comments=max_comments)

        if not comments:
            print("⚠️ 未获取到任何评论")
        else:
            print(f"✅ 获取到 {len(comments)} 条评论")

            # 存储到数据库
            stored = self.db.insert_comments_batch(comments)
            print(f"✅ 已存储 {stored} 条评论到数据库")

        print()
        input("按回车键继续...")

    def analyze_comments(self):
        """分析评论"""
        self.clear_screen()
        self.print_header()

        if not self.ensure_modules():
            input("按回车键继续...")
            return

        # 获取帖子 ID
        post_id = self.current_post_id or self.config.get("post_id", "")
        if not post_id:
            print("[AI 分析] 请先拉取评论或设置 POST_ID")
            input("按回车键继续...")
            return

        self.current_post_id = post_id

        print()
        print(f"[AI 分析] 正在分析帖子 {post_id} 的评论...")
        print()

        # 获取未分析的评论
        unanalyzed = self.db.get_unanalyzed_comments(post_id)
        print(f"待分析评论数: {len(unanalyzed)}")

        if not unanalyzed:
            print("✅ 所有评论均已分析过，无需重复分析")
            input("按回车键继续...")
            return

        # 确认继续
        print()
        print(f"将使用 AI 模型 '{self.config['openai_model']}' 分析 {len(unanalyzed)} 条评论")
        print("这可能需要一些时间，请耐心等待...")
        print()
        confirm = input("是否继续？(y/n): ").strip().lower()

        if confirm != 'y':
            print("已取消")
            input("按回车键继续...")
            return

        print()

        # 分析评论
        def progress_callback(current, total):
            if current % 10 == 0 or current == total:
                print(f"  进度: {current}/{total}")

        analyses = self.ai_analyzer.analyze_comments_batch(
            unanalyzed,
            progress_callback=progress_callback
        )

        print()

        if analyses:
            stored = self.db.insert_analyses_batch(analyses)
            print(f"✅ 已存储 {stored} 条分析结果")
        else:
            print("⚠️ 分析失败，未存储任何结果")

        print()
        input("按回车键继续...")

    def generate_report(self):
        """生成报告"""
        self.clear_screen()
        self.print_header()

        if not self.ensure_modules():
            input("按回车键继续...")
            return

        # 获取帖子 ID
        post_id = self.current_post_id or self.config.get("post_id", "")
        if not post_id:
            print("[生成报告] 请先拉取评论或设置 POST_ID")
            input("按回车键继续...")
            return

        self.current_post_id = post_id

        print()
        print(f"[生成报告] 正在为帖子 {post_id} 生成报告...")
        print()

        # 生成报告
        report_path = self.report_gen.generate_report(
            db=self.db,
            post_id=post_id,
            tweet_info=self.tweet_info
        )

        print()
        print(f"✅ 报告已生成: {report_path}")

        # 显示摘要
        print()
        summary = self.report_gen.generate_summary_text(self.db, post_id)
        print(summary)

        print()
        input("按回车键继续...")

    def view_reports(self):
        """查看历史报告"""
        self.clear_screen()
        self.print_header()

        report_dir = self.config.get("report_dir", "reports")

        print("[查看历史报告]")
        print()

        if not os.path.exists(report_dir):
            print(f"❌ 报告目录 '{report_dir}' 不存在")
            input("按回车键继续...")
            return

        reports = [f for f in os.listdir(report_dir) if f.endswith('.md')]

        if not reports:
            print("📂 暂无历史报告")
            input("按回车键继续...")
            return

        # 按修改时间排序
        reports.sort(key=lambda x: os.path.getmtime(os.path.join(report_dir, x)), reverse=True)

        print(f"共 {len(reports)} 份报告：")
        print()

        for i, report in enumerate(reports, 1):
            full_path = os.path.join(report_dir, report)
            mtime = os.path.getmtime(full_path)
            from datetime import datetime
            mtime_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
            size = os.path.getsize(full_path)
            size_kb = size / 1024

            print(f"  [{i}] {report}")
            print(f"      {mtime_str}  |  {size_kb:.1f} KB")
            print()

        print("请输入报告编号查看内容（0 返回菜单）:")
        choice = input("  > ").strip()

        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(reports):
                self.clear_screen()
                self.print_header()

                full_path = os.path.join(report_dir, reports[idx])
                with open(full_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                print(f"[{reports[idx]}]")
                print()
                print(content)

                print()
                input("按回车键返回菜单...")

    def view_database(self):
        """查看数据库状态"""
        self.clear_screen()
        self.print_header()

        if not self.ensure_modules():
            input("按回车键继续...")
            return

        print("[数据库状态]")
        print()

        # 获取帖子 ID
        post_id = self.current_post_id or self.config.get("post_id", "")

        total = self.db.get_total_count(post_id)
        sentiment_stats = self.db.get_sentiment_stats(post_id)
        intent_stats = self.db.get_intent_stats(post_id)
        unanalyzed = self.db.get_unanalyzed_comments(post_id)

        print(f"数据库文件: {self.config['db_path']}")
        print()

        if post_id:
            print(f"帖子 ID: {post_id}")
        print()

        print(f"📝 总评论数: {total}")
        print(f"🤖 待分析: {len(unanalyzed)}")
        analyzed = total - len(unanalyzed)
        print(f"✅ 已分析: {analyzed}")
        print()

        if sentiment_stats:
            print("💭 情感分布:")
            total_sent = sum(sentiment_stats.values())
            for s, count in sorted(sentiment_stats.items(), key=lambda x: x[1], reverse=True):
                pct = (count / total_sent * 100) if total_sent > 0 else 0
                emoji = {"POSITIVE": "😊", "NEUTRAL": "😐", "NEGATIVE": "😠"}.get(s, "❓")
                print(f"    {emoji} {s}: {count} ({pct:.1f}%)")
            print()

        if intent_stats:
            print("🎯 意图分布:")
            total_int = sum(intent_stats.values())
            for i, count in sorted(intent_stats.items(), key=lambda x: x[1], reverse=True):
                pct = (count / total_int * 100) if total_int > 0 else 0
                print(f"    {i}: {count} ({pct:.1f}%)")

        print()
        input("按回车键继续...")

    def cleanup(self):
        """清理资源"""
        if self.db:
            self.db.close()
        print("再见！👋")

    def run(self):
        """运行主循环"""
        self.clear_screen()

        while True:
            self.clear_screen()
            self.print_header()
            self.print_menu()

            choice = input("请输入选项编号: ").strip()

            if choice == '1':
                self.check_config()
            elif choice == '2':
                self.fetch_comments()
            elif choice == '3':
                self.analyze_comments()
            elif choice == '4':
                self.generate_report()
            elif choice == '5':
                self.view_reports()
            elif choice == '6':
                self.view_database()
            elif choice == '0':
                self.cleanup()
                break
            else:
                print("❌ 无效的选项，请重新选择")
                input("按回车键继续...")


def main():
    """入口函数"""
    cli = CLI()
    cli.run()


if __name__ == "__main__":
    main()
