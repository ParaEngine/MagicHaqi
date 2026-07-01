"""
AI回复总结评论 - 主入口
社交媒体评论聚合与分析智能体

完整工作流：
1. 从 Twitter 拉取指定帖子的评论
2. 使用 AI 对评论进行情感分析和意图分类
3. 将原始评论和分析结果存入 SQLite 数据库
4. 生成结构化的 Markdown 分析报告

使用方式：
    python main.py        # 启动交互式界面
    python main.py --run  # 直接运行完整流程
"""

import os
import sys
from dotenv import load_dotenv

from database import Database
from twitter_collector import TwitterCollector
from ai_analyzer import AIAnalyzer
from report_generator import ReportGenerator


def load_config() -> dict:
    """
    从环境变量加载配置

    Returns:
        配置字典
    """
    # 加载 .env 文件
    load_dotenv()

    config = {
        "twitter_bearer_token": os.getenv("TWITTER_BEARER_TOKEN", ""),
        "post_id": os.getenv("POST_ID", ""),
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "openai_base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"),
        "db_path": os.getenv("DB_PATH", "socialecho.db"),
        "report_dir": os.getenv("REPORT_DIR", "reports"),
    }

    return config


def validate_config(config: dict) -> bool:
    """
    验证配置是否完整

    Args:
        config: 配置字典

    Returns:
        配置是否有效
    """
    required = [
        ("twitter_bearer_token", "TWITTER_BEARER_TOKEN"),
        ("post_id", "POST_ID"),
        ("openai_api_key", "OPENAI_API_KEY"),
    ]

    missing = []
    for key, env_name in required:
        if not config.get(key):
            missing.append(env_name)

    if missing:
        print("❌ 缺少必要的环境变量:")
        for env_name in missing:
            print(f"   - {env_name}")
        print("")
        print("请复制 .env.example 为 .env 并填入相应配置。")
        return False

    return True


def main():
    """
    主函数 - 演示完整工作流：
    拉取评论 -> 分析评论 -> 存储结果 -> 生成报告
    """
    print("=" * 60)
    print("  AI回复总结评论")
    print("=" * 60)
    print()

    # 第一步：加载并验证配置
    print("[1/5] 加载配置...")
    config = load_config()

    if not validate_config(config):
        sys.exit(1)

    print("   ✓ 配置加载成功")
    print(f"   - 目标帖子: {config['post_id']}")
    print(f"   - AI 模型: {config['openai_model']}")
    print()

    # 第二步：初始化各模块
    print("[2/5] 初始化模块...")

    db = Database(config["db_path"])
    print("   ✓ 数据库模块已就绪")

    twitter = TwitterCollector(config["twitter_bearer_token"])
    print("   ✓ Twitter 收集器已就绪")

    ai_analyzer = AIAnalyzer(
        api_key=config["openai_api_key"],
        base_url=config["openai_base_url"],
        model=config["openai_model"]
    )
    print("   ✓ AI 分析器已就绪")

    report_gen = ReportGenerator(config["report_dir"])
    print("   ✓ 报告生成器已就绪")
    print()

    try:
        # 第三步：拉取评论
        print("[3/5] 拉取 Twitter 评论...")
        print()

        # 获取推文基本信息
        tweet_info = twitter.get_tweet_info(config["post_id"])
        if tweet_info:
            print(f"   推文作者: @{tweet_info.get('author_username', 'unknown')}")
            print(f"   推文内容: {tweet_info.get('text', '')[:100]}...")
            print()

        # 拉取评论
        comments = twitter.fetch_comments(config["post_id"])

        if not comments:
            print("⚠️  未获取到任何评论，程序结束")
            sys.exit(0)

        # 存储评论到数据库
        stored_count = db.insert_comments_batch(comments)
        print(f"   ✓ 已存储 {stored_count} 条评论到数据库")
        print()

        # 第四步：AI 分析评论
        print("[4/5] AI 分析评论...")
        print()

        # 获取未分析的评论（支持增量分析）
        unanalyzed = db.get_unanalyzed_comments(config["post_id"])
        print(f"   待分析评论数: {len(unanalyzed)}")

        if unanalyzed:
            analyses = ai_analyzer.analyze_comments_batch(unanalyzed)

            # 存储分析结果
            stored_analyses = db.insert_analyses_batch(analyses)
            print(f"   ✓ 已存储 {stored_analyses} 条分析结果")
        else:
            print("   所有评论均已分析过，跳过 AI 分析")
        print()

        # 第五步：生成报告
        print("[5/5] 生成分析报告...")
        print()

        report_path = report_gen.generate_report(
            db=db,
            post_id=config["post_id"],
            tweet_info=tweet_info
        )
        print()

        # 打印摘要
        summary = report_gen.generate_summary_text(db, config["post_id"])
        print(summary)
        print()

        print(f"🎉 任务完成！")
        print(f"📄 报告已保存至: {report_path}")
        print()

    except KeyboardInterrupt:
        print("\n\n⚠️  用户中断操作")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ 程序运行出错: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    # 命令行参数处理
    if len(sys.argv) > 1 and sys.argv[1] == "--run":
        # 直接运行完整流程
        main()
    else:
        # 启动交互式界面
        from ui import CLI
        cli = CLI()
        try:
            cli.run()
        except KeyboardInterrupt:
            print("\n\n再见！👋")
