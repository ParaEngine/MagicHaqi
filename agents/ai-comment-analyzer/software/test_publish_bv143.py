"""
针对视频 BV143eFzyEwW 的真实发布测试脚本
完整测试：连接 → 拉取评论 → 发布回复 → 验证结果
"""

import os
import sys
import time
from dotenv import load_dotenv

load_dotenv()

TEST_BVID = "BV143eFzyEwW"


def test_all():
    """完整测试流程"""
    print("\n" + "=" * 70)
    print(f"  🎯 针对视频 {TEST_BVID} 的真实发布测试")
    print("=" * 70)

    from platforms.bilibili import BilibiliCollector

    sessdata = os.getenv("BILIBILI_SESSDATA", "").strip()
    bili_jct = os.getenv("BILIBILI_BILI_JCT", "").strip()

    if not sessdata or not bili_jct:
        print("❌ 未配置 SESSDATA 或 bili_jct")
        return

    # 步骤1：创建收集器并测试连接
    print("\n" + "=" * 70)
    print("  🔌 步骤1: B站连接测试")
    print("=" * 70)
    try:
        collector = BilibiliCollector(sessdata, bili_jct)
        result = collector.test_connection()
        if result.get("success"):
            print(f"✅ 连接成功")
            print(f"   用户: {result.get('user', {}).get('name', '')}")
        else:
            print(f"❌ 连接失败: {result.get('message')}")
            return
    except Exception as e:
        print(f"❌ 连接异常: {e}")
        return

    # 步骤2：获取视频信息
    print("\n" + "=" * 70)
    print("  📺 步骤2: 获取视频信息")
    print("=" * 70)
    video_info = collector.get_post_info(TEST_BVID)
    if video_info:
        print(f"✅ 获取视频信息成功")
        print(f"   标题: {video_info.get('title', '')[:60]}")
        print(f"   作者: {video_info.get('author_name', '')}")
        print(f"   评论数: {video_info.get('comment_count', 0)}")
        print(f"   链接: {video_info.get('url', '')}")
    else:
        print("❌ 获取视频信息失败")
        return

    # 步骤3：拉取评论
    print("\n" + "=" * 70)
    print("  📥 步骤3: 拉取评论")
    print("=" * 70)
    comments = collector.fetch_comments(TEST_BVID, max_comments=10)
    print(f"✅ 成功拉取 {len(comments)} 条评论")

    if not comments:
        print("❌ 没有评论可以回复")
        return

    test_comment = comments[0]
    rpid = test_comment.get("id", "")
    author = test_comment.get("author_username", "")
    text = test_comment.get("text", "")

    print(f"\n目标评论:")
    print(f"  作者: {author}")
    print(f"  内容: {text[:80]}")
    print(f"  rpid: {rpid}")

    # 步骤4：发布回复
    print("\n" + "=" * 70)
    print("  📤 步骤4: 发布回复")
    print("=" * 70)

    reply_text = "感谢你的反馈！（这是一条测试回复，用于验证发布功能）"
    print(f"\n回复内容: {reply_text}")
    print(f"\n⚠️ 即将发布，请确认...")
    time.sleep(2)

    print("\n🚀 正在发布...")
    try:
        result = collector.reply_comment(rpid, reply_text, bvid=TEST_BVID)

        if result.get("success"):
            new_rpid = result.get("rpid", "")
            print(f"\n✅ 发布成功！")
            print(f"   新回复 rpid: {new_rpid}")
            print(f"   返回数据: {result.get('data', {})}")
        else:
            print(f"\n❌ 发布失败")
            print(f"   错误码: {result.get('code', 'N/A')}")
            print(f"   错误信息: {result.get('error', '未知错误')}")
            if result.get("raw"):
                print(f"   原始返回: {result.get('raw')}")
            return

    except Exception as e:
        print(f"\n❌ 发布异常: {e}")
        import traceback
        traceback.print_exc()
        return

    # 步骤5：验证回复
    print("\n" + "=" * 70)
    print("  🔍 步骤5: 验证回复")
    print("=" * 70)

    print(f"\n⏳ 等待5秒让评论生效...")
    time.sleep(5)

    print(f"\n🔄 重新拉取评论验证...")
    comments_new = collector.fetch_comments(TEST_BVID, max_comments=20)

    found = False
    for c in comments_new:
        if c.get("id") == str(new_rpid):
            found = True
            print(f"\n✅ 回复成功显示在评论列表中！")
            print(f"   作者: {c.get('author_username', '')}")
            print(f"   内容: {c.get('text', '')}")
            print(f"   rpid: {c.get('id', '')}")
            break

    if not found:
        print(f"\n⚠️  回复未在最新评论中找到")
        print(f"   可能原因:")
        print(f"   1. 回复需要审核")
        print(f"   2. 评论排序问题")
        print(f"   3. 回复失败")
        print(f"\n💡 建议: 手动打开视频页面查看: https://www.bilibili.com/video/{TEST_BVID}")

    # 总结
    print("\n" + "=" * 70)
    print("  📊 测试总结")
    print("=" * 70)
    print(f"\n  视频: {TEST_BVID}")
    print(f"  连接: ✅ 成功")
    print(f"  拉取评论: ✅ 成功 ({len(comments)} 条)")
    print(f"  发布回复: ✅ 成功")
    print(f"  回复rpid: {new_rpid}")
    print(f"  验证结果: {'✅ 成功' if found else '⚠️ 待手动确认'}")
    print(f"\n  🌐 视频链接: https://www.bilibili.com/video/{TEST_BVID}")
    print("=" * 70)


if __name__ == "__main__":
    test_all()
