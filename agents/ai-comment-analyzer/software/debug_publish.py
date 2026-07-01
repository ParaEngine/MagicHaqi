"""
B站发布功能完整调试脚本
分步验证：配置检查 → 连接测试 → 拉取评论 → 发布回复 → 验证结果
"""

import os
import sys
import time
from dotenv import load_dotenv

load_dotenv()


def get_config():
    """获取配置：优先从环境变量，其次提示用户输入"""
    print("=" * 70)
    print("  📋 步骤 0: 配置检查")
    print("=" * 70)

    sessdata = os.getenv("BILIBILI_SESSDATA", "").strip()
    bili_jct = os.getenv("BILIBILI_BILI_JCT", "").strip()

    if not sessdata:
        print("\n⚠️  未检测到 BILIBILI_SESSDATA 环境变量")
        print("   你可以从浏览器 Cookie 中复制 SESSDATA 的值")
        print("   获取方式：登录B站 → F12 → Application → Cookies → SESSDATA")
        sessdata = input("\n请输入 SESSDATA: ").strip()
        if not sessdata:
            print("❌ SESSDATA 不能为空，退出")
            return None, None
    else:
        print(f"✅ SESSDATA: 已配置 ({len(sessdata)} 字符)")

    if not bili_jct:
        print("\n⚠️  未检测到 BILIBILI_BILI_JCT 环境变量")
        print("   bili_jct 即 CSRF Token，用于发布回复")
        bili_jct = input("请输入 bili_jct: ").strip()
        if not bili_jct:
            print("❌ bili_jct 不能为空，退出")
            return None, None
    else:
        print(f"✅ bili_jct: 已配置 ({len(bili_jct)} 字符)")

    return sessdata, bili_jct


def test_connection(sessdata, bili_jct):
    """测试1：B站连接测试"""
    print("\n" + "=" * 70)
    print("  🔌 步骤 1: B站连接测试")
    print("=" * 70)

    from platforms.bilibili import BilibiliCollector

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


def test_fetch_comments(collector):
    """测试2：拉取评论"""
    print("\n" + "=" * 70)
    print("  📥 步骤 2: 拉取评论测试")
    print("=" * 70)

    test_bvid = input("\n请输入测试视频 BV号 (直接回车用默认): ").strip()
    if not test_bvid:
        test_bvid = "BV1GJ411x7h7"
        print(f"使用默认测试视频: {test_bvid}")

    try:
        print(f"\n📺 获取视频信息...")
        video_info = collector.get_post_info(test_bvid)
        if video_info:
            print(f"✅ 获取视频信息成功")
            print(f"   标题: {video_info.get('title', '')[:60]}")
            print(f"   作者: {video_info.get('author_name', '')}")
            print(f"   评论数: {video_info.get('comment_count', 0)}")
            print(f"   链接: {video_info.get('url', '')}")
            aid = video_info.get("id", "")
        else:
            print("❌ 获取视频信息失败")
            return None, None, None

        print(f"\n💬 拉取评论中 (最多5条)...")
        comments = collector.fetch_comments(test_bvid, max_comments=5)
        print(f"\n✅ 成功拉取 {len(comments)} 条评论")

        if comments:
            print("\n📝 评论预览:")
            for i, c in enumerate(comments):
                print(f"\n  [{i+1}] 作者: {c.get('author_username', '未知')}")
                print(f"      内容: {c.get('text', '')[:80]}")
                print(f"      rpid: {c.get('id', '')}")
                print(f"      点赞: {c.get('like_count', 0)}")

        return test_bvid, comments, video_info

    except Exception as e:
        print(f"\n❌ 拉取评论失败: {e}")
        import traceback
        traceback.print_exc()
        return None, None, None


def test_publish_reply(collector, bvid, comments):
    """测试3：发布回复"""
    print("\n" + "=" * 70)
    print("  📤 步骤 3: 发布回复测试")
    print("=" * 70)

    if not comments:
        print("❌ 没有评论可以回复")
        return None

    print(f"\n🎯 选择第一条评论进行测试回复")
    test_comment = comments[0]
    rpid = test_comment.get("id", "")
    author = test_comment.get("author_username", "")
    text = test_comment.get("text", "")

    print(f"\n目标评论信息:")
    print(f"  作者: {author}")
    print(f"  内容: {text[:100]}")
    print(f"  rpid: {rpid}")
    print(f"  视频: {bvid}")

    reply_text = input("\n请输入回复内容 (直接回车用默认, 输入 skip 跳过): ").strip()
    if reply_text.lower() == "skip":
        print("⏭️  跳过发布测试")
        return None
    if not reply_text:
        reply_text = "感谢你的反馈！（这是一条测试回复）"
        print(f"使用默认回复: {reply_text}")

    print(f"\n📝 回复内容: {reply_text}")
    confirm = input("\n⚠️  确认发布这条回复? (输入 YES 确认): ").strip()

    if confirm != "YES":
        print("⏭️  已取消发布")
        return None

    print(f"\n🚀 正在发布回复...")
    try:
        result = collector.reply_comment(rpid, reply_text, bvid=bvid)

        if result.get("success"):
            print(f"\n✅ 发布成功！")
            print(f"   新回复 rpid: {result.get('rpid', '')}")
            print(f"   返回数据: {result.get('data', {})}")
            return result
        else:
            print(f"\n❌ 发布失败")
            print(f"   错误: {result.get('error', '未知错误')}")
            print(f"   错误码: {result.get('code', 'N/A')}")
            if result.get('raw'):
                print(f"   原始返回: {result.get('raw')}")
            return result

    except Exception as e:
        print(f"\n❌ 发布异常: {e}")
        import traceback
        traceback.print_exc()
        return None


def verify_reply(collector, bvid, target_rpid):
    """测试4：验证回复是否成功出现"""
    print("\n" + "=" * 70)
    print("  🔍 步骤 4: 验证回复是否成功显示")
    print("=" * 70)

    if not target_rpid:
        print("❌ 没有回复 rpid 可验证")
        return False

    print(f"\n⏳ 等待3秒让评论生效...")
    time.sleep(3)

    try:
        print(f"🔄 重新拉取评论，检查回复是否出现...")
        comments = collector.fetch_comments(bvid, max_comments=10)

        found = False
        for c in comments:
            if c.get("id") == str(target_rpid):
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
            print(f"\n💡 建议: 手动打开视频页面查看: https://www.bilibili.com/video/{bvid}")

        return found

    except Exception as e:
        print(f"\n❌ 验证失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """主函数"""
    print("\n" + "🎮" * 25)
    print("  B站发布功能完整调试工具")
    print("  分步验证：配置 → 连接 → 拉取 → 发布 → 验证")
    print("🎮" * 25)

    # 步骤0：获取配置
    sessdata, bili_jct = get_config()
    if not sessdata:
        return

    # 步骤1：连接测试
    collector = test_connection(sessdata, bili_jct)
    if not collector:
        print("\n❌ 连接测试失败，请检查 Cookie 配置")
        return

    # 步骤2：拉取评论
    bvid, comments, video_info = test_fetch_comments(collector)
    if not comments:
        print("\n❌ 拉取评论失败或无评论")
        return

    # 步骤3：发布回复
    publish_result = test_publish_reply(collector, bvid, comments)
    if not publish_result:
        print("\nℹ️  发布测试已跳过或失败")
        print("\n" + "=" * 70)
        print("  🏁 调试结束 (未完成发布测试)")
        print("=" * 70)
        return

    # 步骤4：验证回复
    new_rpid = publish_result.get("rpid", "")
    if new_rpid:
        verify_reply(collector, bvid, new_rpid)

    print("\n" + "=" * 70)
    print("  ✅ 调试完成")
    print("=" * 70)
    print(f"\n📊 测试总结:")
    print(f"   ✅ B站连接: 成功")
    print(f"   ✅ 评论拉取: 成功 ({len(comments)} 条)")
    print(f"   ✅ 回复发布: 成功")
    print(f"   🔍 回复rpid: {new_rpid}")
    print(f"\n🌐 手动验证: https://www.bilibili.com/video/{bvid}")


if __name__ == "__main__":
    main()
