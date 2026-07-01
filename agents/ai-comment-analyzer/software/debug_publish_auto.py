"""
B站发布功能自动调试脚本（非交互式）
使用默认配置和测试视频进行自动化测试
"""

import os
import sys
import time
from dotenv import load_dotenv

load_dotenv()

TEST_BVID = "BV1C4RLBHEYg"


def test_connection():
    print("=" * 70)
    print("  🔌 测试1: B站连接测试")
    print("=" * 70)

    from platforms.bilibili import BilibiliCollector

    sessdata = os.getenv("BILIBILI_SESSDATA", "").strip()
    bili_jct = os.getenv("BILIBILI_BILI_JCT", "").strip()

    if not sessdata:
        print("❌ 未配置 BILIBILI_SESSDATA")
        return None
    if not bili_jct:
        print("❌ 未配置 BILIBILI_BILI_JCT")
        return None

    print(f"SESSDATA: 已配置 ({len(sessdata)} 字符)")
    print(f"bili_jct: 已配置 ({len(bili_jct)} 字符)")

    try:
        collector = BilibiliCollector(sessdata, bili_jct)
        result = collector.test_connection()

        if result.get("success"):
            print(f"\n✅ 连接成功！")
            print(f"   状态: {result.get('message')}")
            user = result.get("user")
            if user:
                print(f"   用户名: {user.get('name')}")
                print(f"   UID: {user.get('mid')}")
            return collector
        else:
            print(f"\n❌ 连接失败")
            print(f"   错误: {result.get('message')}")
            print(f"   错误码: {result.get('code', 'N/A')}")
            return None
    except Exception as e:
        print(f"\n❌ 连接异常: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_fetch_comments(collector, bvid):
    print("\n" + "=" * 70)
    print("  📥 测试2: 拉取评论测试")
    print("=" * 70)
    print(f"\n测试视频: {bvid}")

    try:
        print(f"\n📺 获取视频信息...")
        video_info = collector.get_post_info(bvid)
        if video_info:
            print(f"✅ 获取视频信息成功")
            print(f"   标题: {video_info.get('title', '')[:60]}")
            print(f"   作者: {video_info.get('author_name', '')}")
            print(f"   评论数: {video_info.get('comment_count', 0)}")
            print(f"   链接: {video_info.get('url', '')}")
        else:
            print("❌ 获取视频信息失败")
            return None, None

        print(f"\n💬 拉取评论中 (最多10条)...")
        comments = collector.fetch_comments(bvid, max_comments=10)
        print(f"\n✅ 成功拉取 {len(comments)} 条评论")

        if comments:
            print("\n📝 前5条评论预览:")
            for i, c in enumerate(comments[:5]):
                print(f"\n  [{i+1}] 作者: {c.get('author_username', '未知')}")
                print(f"      内容: {c.get('text', '')[:80]}")
                print(f"      rpid: {c.get('id', '')}")
                print(f"      点赞: {c.get('like_count', 0)}")

        return comments, video_info

    except Exception as e:
        print(f"\n❌ 拉取评论失败: {e}")
        import traceback
        traceback.print_exc()
        return None, None


def test_reply_api(collector, bvid, comments):
    print("\n" + "=" * 70)
    print("  📤 测试3: 回复API调用测试 (仅测试，不实际发布)")
    print("=" * 70)

    if not comments:
        print("❌ 没有评论可以测试")
        return None

    test_comment = comments[0]
    rpid = test_comment.get("id", "")
    author = test_comment.get("author_username", "")

    print(f"\n目标评论:")
    print(f"  作者: {author}")
    print(f"  rpid: {rpid}")
    print(f"  视频: {bvid}")

    print(f"\n🧪 测试: 检查 reply_comment 方法是否存在且参数正确...")

    if hasattr(collector, 'reply_comment'):
        print("✅ reply_comment 方法存在")
    else:
        print("❌ reply_comment 方法不存在")
        return None

    import inspect
    sig = inspect.signature(collector.reply_comment)
    print(f"   方法签名: {sig}")

    print(f"\n🧪 测试: 测试参数构造...")
    try:
        from platforms.bilibili import BilibiliCollector

        aid = collector._bv_to_aid(bvid)
        print(f"✅ BV转AID成功: {bvid} -> aid={aid}")

        csrf = collector.bili_jct
        print(f"✅ CSRF Token 已获取: {csrf[:8]}...")

        test_data = {
            "oid": str(aid),
            "type": 1,
            "message": "test",
            "plat": 1,
            "root": rpid,
            "parent": rpid,
            "csrf": csrf,
            "csrf_token": csrf,
        }
        print(f"✅ 请求参数构造成功:")
        for k, v in test_data.items():
            if k == 'message':
                print(f"     {k}: {v}")
            elif k in ['csrf', 'csrf_token']:
                print(f"     {k}: {v[:8]}...")
            else:
                print(f"     {k}: {v}")

        return {
            "aid": aid,
            "rpid": rpid,
            "bvid": bvid,
            "csrf": csrf,
        }
    except Exception as e:
        print(f"❌ 参数构造失败: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    print("\n" + "=" * 70)
    print("  🎮 B站发布功能自动调试工具")
    print("  自动测试：连接 → 拉取 → API参数验证")
    print("=" * 70)

    collector = test_connection()
    if not collector:
        print("\n❌ 连接测试失败")
        return

    bvid = TEST_BVID
    comments, video_info = test_fetch_comments(collector, bvid)

    if comments:
        test_reply_api(collector, bvid, comments)

    print("\n" + "=" * 70)
    print("  📊 测试总结")
    print("=" * 70)
    print(f"\n  ✅ 连接测试: 成功")
    if comments is not None:
        print(f"  ✅ 拉取评论: 成功 ({len(comments)} 条)")
    else:
        print(f"  ❌ 拉取评论: 失败")
    print(f"\n  💡 要测试真实发布，请运行: python debug_publish.py")
    print(f"     或在 Streamlit UI 中进行测试")
    print("=" * 70)


if __name__ == "__main__":
    main()
