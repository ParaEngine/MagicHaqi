"""
测试新的报告生成功能
验证四个新模块是否正常工作
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

from database import Database
from report_generator import ReportGenerator


def test_report_without_deep_analysis():
    """测试不包含深度分析的报告"""
    print("=" * 70)
    print("  测试1: 基础报告（无深度分析）")
    print("=" * 70)

    db = Database("ai-reply-summary.db")
    report_gen = ReportGenerator("reports")

    posts = db.get_posts("bilibili")
    if not posts:
        print("❌ 数据库中没有B站帖子数据")
        return

    post = posts[0]
    post_id = post["id"]
    print(f"测试帖子: {post.get('title', post_id)[:60]}")

    report_path = report_gen.generate_report(
        db=db,
        post_id=post_id,
        platform="bilibili",
        post_info=post,
        ai_analyzer=None
    )

    print(f"\n✅ 报告生成成功: {report_path}")

    with open(report_path, 'r', encoding='utf-8') as f:
        content = f.read()

    print(f"\n📊 报告长度: {len(content)} 字符")
    print(f"\n📑 报告章节:")
    for line in content.split('\n'):
        if line.startswith('## '):
            print(f"   {line}")

    return report_path


def test_report_with_deep_analysis():
    """测试包含深度分析的报告"""
    print("\n" + "=" * 70)
    print("  测试2: 完整报告（含AI深度分析）")
    print("=" * 70)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("⚠️  未配置 OPENAI_API_KEY，跳过深度分析测试")
        print("   你可以在 .env 文件中配置后重试")
        return

    from ai_analyzer import AIAnalyzer

    db = Database("ai-reply-summary.db")
    report_gen = ReportGenerator("reports")

    posts = db.get_posts("bilibili")
    if not posts:
        print("❌ 数据库中没有B站帖子数据")
        return

    post = posts[0]
    post_id = post["id"]
    print(f"测试帖子: {post.get('title', post_id)[:60]}")

    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")

    print(f"\n🤖 AI配置:")
    print(f"   模型: {model}")
    print(f"   Base URL: {base_url}")

    ai = AIAnalyzer(
        api_key=api_key,
        base_url=base_url,
        model=model
    )

    print("\n📝 正在生成报告（含深度分析）...")
    report_path = report_gen.generate_report(
        db=db,
        post_id=post_id,
        platform="bilibili",
        post_info=post,
        ai_analyzer=ai
    )

    print(f"\n✅ 报告生成成功: {report_path}")

    with open(report_path, 'r', encoding='utf-8') as f:
        content = f.read()

    print(f"\n📊 报告长度: {len(content)} 字符")
    print(f"\n📑 报告章节:")
    for line in content.split('\n'):
        if line.startswith('## '):
            print(f"   {line}")

    # 检查四个新模块是否存在
    new_modules = [
        "用户反馈痛点",
        "Bug 反馈",
        "改进建议",
        "问题优先级排序"
    ]

    print(f"\n🔍 检查新模块:")
    for module in new_modules:
        if module in content:
            print(f"   ✅ {module} - 已包含")
        else:
            print(f"   ❌ {module} - 未找到")

    return report_path


def main():
    print("\n" + "🚀" * 25)
    print("  报告生成新功能测试")
    print("  验证：痛点分析、Bug反馈、改进建议、优先级排序")
    print("🚀" * 25)

    # 测试1: 基础报告
    test_report_without_deep_analysis()

    # 测试2: 深度分析报告
    test_report_with_deep_analysis()

    print("\n" + "=" * 70)
    print("  ✅ 测试完成")
    print("=" * 70)


if __name__ == "__main__":
    main()
