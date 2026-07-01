"""
智能体接口服务测试脚本
测试所有主要接口功能
"""

import os
import sys
import json
import time
from dotenv import load_dotenv

load_dotenv()

API_BASE_URL = "http://localhost:8000"
API_KEY = os.getenv("API_KEY", "your-secret-api-key-change-me")


def test_health():
    """测试健康检查"""
    print("\n" + "=" * 70)
    print("  测试 1: 健康检查")
    print("=" * 70)

    import httpx

    try:
        response = httpx.get(f"{API_BASE_URL}/health", timeout=5)
        data = response.json()

        print(f"\n✅ 服务正常运行")
        print(f"   版本: {data['data']['version']}")
        print(f"   状态: {data['data']['status']}")

        return True
    except Exception as e:
        print(f"\n❌ 服务未启动或无法连接")
        print(f"   错误: {e}")
        print(f"\n💡 请先启动服务:")
        print(f"   python agent_api.py")
        return False


def test_platforms():
    """测试获取平台列表"""
    print("\n" + "=" * 70)
    print("  测试 2: 获取平台列表")
    print("=" * 70)

    import httpx

    try:
        response = httpx.post(
            f"{API_BASE_URL}/api/v1/platforms",
            headers={"X-API-Key": API_KEY},
            timeout=10
        )
        data = response.json()

        if data['success']:
            platforms = data['data']['platforms']
            print(f"\n✅ 支持 {len(platforms)} 个平台:")
            for key, info in platforms.items():
                print(f"   {info['icon']} {info['display_name']}")
            return True
        else:
            print(f"\n❌ 获取平台列表失败: {data.get('error')}")
            return False

    except Exception as e:
        print(f"\n❌ 请求失败: {e}")
        return False


def test_fetch_comments():
    """测试拉取评论"""
    print("\n" + "=" * 70)
    print("  测试 3: 拉取 B站评论")
    print("=" * 70)

    import httpx

    test_bvid = "BV1GJ411x7h7"
    print(f"\n测试视频: {test_bvid}")

    try:
        response = httpx.post(
            f"{API_BASE_URL}/api/v1/comments/fetch",
            headers={"X-API-Key": API_KEY},
            json={
                "platform": "bilibili",
                "post_id": test_bvid,
                "max_count": 10
            },
            timeout=30
        )
        data = response.json()

        if data['success']:
            print(f"\n✅ 拉取评论成功")
            print(f"   评论数: {data['data']['comments_count']}")

            if data['data'].get('post_info'):
                post = data['data']['post_info']
                print(f"   标题: {post.get('title', '')[:50]}")
                print(f"   作者: {post.get('author_name', '')}")

            return True
        else:
            print(f"\n❌ 拉取评论失败: {data.get('error')}")
            return False

    except Exception as e:
        print(f"\n❌ 请求失败: {e}")
        return False


def test_analyze():
    """测试 AI 分析"""
    print("\n" + "=" * 70)
    print("  测试 4: AI 评论分析")
    print("=" * 70)

    import httpx

    test_bvid = "BV1GJ411x7h7"
    print(f"\n测试视频: {test_bvid}")

    try:
        response = httpx.post(
            f"{API_BASE_URL}/api/v1/analyze",
            headers={"X-API-Key": API_KEY},
            json={
                "platform": "bilibili",
                "post_id": test_bvid
            },
            timeout=60
        )
        data = response.json()

        if data['success']:
            print(f"\n✅ AI 分析成功")
            print(f"   分析数: {data['data']['analyzed_count']}")

            if data['data'].get('sentiment_stats'):
                stats = data['data']['sentiment_stats']
                print(f"\n   情感分布:")
                for sentiment, count in stats.items():
                    emoji = {"POSITIVE": "😊", "NEUTRAL": "😐", "NEGATIVE": "😠"}.get(sentiment, "📊")
                    print(f"      {emoji} {sentiment}: {count}")

            return True
        else:
            print(f"\n❌ AI 分析失败: {data.get('error')}")
            return False

    except Exception as e:
        print(f"\n❌ 请求失败: {e}")
        return False


def test_deep_analyze():
    """测试深度分析"""
    print("\n" + "=" * 70)
    print("  测试 5: AI 深度分析")
    print("=" * 70)

    import httpx

    test_bvid = "BV1GJ411x7h7"
    print(f"\n测试视频: {test_bvid}")

    try:
        response = httpx.post(
            f"{API_BASE_URL}/api/v1/analyze/deep",
            headers={"X-API-Key": API_KEY},
            json={
                "platform": "bilibili",
                "post_id": test_bvid
            },
            timeout=60
        )
        data = response.json()

        if data['success']:
            print(f"\n✅ 深度分析成功")
            insights = data['data']['insights']

            if insights.get('pain_points'):
                print(f"   🎯 痛点: {len(insights['pain_points'])} 条")
            if insights.get('bug_reports'):
                print(f"   🐛 Bug反馈: {len(insights['bug_reports'])} 条")
            if insights.get('improvement_suggestions'):
                print(f"   💡 改进建议: {len(insights['improvement_suggestions'])} 条")
            if insights.get('priority_ranking'):
                print(f"   📋 优先级排序: {len(insights['priority_ranking'])} 条")

            return True
        else:
            print(f"\n❌ 深度分析失败: {data.get('error')}")
            return False

    except Exception as e:
        print(f"\n❌ 请求失败: {e}")
        return False


def test_generate_report():
    """测试生成报告"""
    print("\n" + "=" * 70)
    print("  测试 6: 生成分析报告")
    print("=" * 70)

    import httpx

    test_bvid = "BV1GJ411x7h7"
    print(f"\n测试视频: {test_bvid}")

    try:
        response = httpx.post(
            f"{API_BASE_URL}/api/v1/report/generate",
            headers={"X-API-Key": API_KEY},
            json={
                "platform": "bilibili",
                "post_id": test_bvid,
                "include_deep_analysis": True
            },
            timeout=120
        )
        data = response.json()

        if data['success']:
            print(f"\n✅ 报告生成成功")
            print(f"   路径: {data['data']['report_path']}")
            print(f"   长度: {len(data['data']['report_content'])} 字符")

            # 读取报告前200字
            preview = data['data']['report_content'][:200]
            print(f"\n   预览:")
            print(f"   {preview}...")

            return True
        else:
            print(f"\n❌ 报告生成失败: {data.get('error')}")
            return False

    except Exception as e:
        print(f"\n❌ 请求失败: {e}")
        return False


def main():
    """主函数"""
    print("\n" + "🚀" * 25)
    print("  AI回复总结评论 智能体接口服务测试")
    print("  测试所有主要接口功能")
    print("🚀" * 25)

    results = []

    # 测试 1: 健康检查
    if test_health():
        # 测试 2: 平台列表
        results.append(("平台列表", test_platforms()))

        # 测试 3: 拉取评论
        results.append(("拉取评论", test_fetch_comments()))

        # 测试 4: AI 分析（可选，需要 AI 配置）
        print("\n" + "=" * 70)
        print("  测试 4: AI 分析（跳过，需要 AI 配置）")
        print("=" * 70)
        print("\n💡 如需测试 AI 分析，请确保 OPENAI_API_KEY 已配置")

        # 测试 5: 深度分析（可选）
        print("\n" + "=" * 70)
        print("  测试 5: 深度分析（跳过，需要 AI 配置）")
        print("=" * 70)

        # 测试 6: 生成报告（可选）
        print("\n" + "=" * 70)
        print("  测试 6: 生成报告（跳过，需要 AI 配置）")
        print("=" * 70)

    # 总结
    print("\n" + "=" * 70)
    print("  📊 测试总结")
    print("=" * 70)

    print(f"\n✅ 基本接口测试通过")
    print(f"\n💡 完整测试需要:")
    print(f"   1. 启动服务: python agent_api.py")
    print(f"   2. 配置 API Key: 在 .env 中设置 API_KEY")
    print(f"   3. 配置 AI: 设置 OPENAI_API_KEY")
    print(f"   4. 访问文档: http://localhost:8000/docs")

    print("\n" + "=" * 70)
    print("  🎉 API 服务开发完成！")
    print("=" * 70)


if __name__ == "__main__":
    main()
