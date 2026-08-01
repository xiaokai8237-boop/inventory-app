#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""物流筐收发管理系统 - 全功能自动化测试"""
from playwright.sync_api import sync_playwright
import time, json, sys

URL = "https://inventory-app-9ql.pages.dev/"
TEST_IMAGE = "/workspace/演示单据.png"
results = []

def report(name, ok, detail=""):
    status = "✅ PASS" if ok else "❌ FAIL"
    results.append((name, ok, detail))
    print(f"{status} {name}{(' - ' + detail) if detail else ''}")


def click_btn(page, selector, timeout=10000):
    """滚动到可见后点击"""
    try:
        loc = page.locator(selector).first
        loc.scroll_into_view_if_needed(timeout=3000)
        loc.click(timeout=timeout)
        return True
    except Exception as e:
        print(f"  点击失败[{selector}]: {str(e)[:50]}")
        return False

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True)
        page = context.new_page()
        page.set_default_timeout(12000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1. 首页加载
        page.goto(URL, wait_until="domcontentloaded")
        time.sleep(2.5)
        title = page.title()
        report("首页加载", "物流筐收发管理系统" in title or page.locator("h1").count() > 0, f"title={title}")
        report("首页无JS错误", len(errors) == 0, "; ".join(errors[:3]))
        # 关闭首次打开的欢迎弹窗（如果弹出）
        try:
            page.locator("#welcomeModal.show button:has-text('开始使用')").first.click(timeout=2000)
            time.sleep(0.5)
        except: pass

        # 2. 发出按钮
        click_btn(page, "button:has-text('发出')")
        time.sleep(1.2)
        manual_visible = page.locator("#manualForm").is_visible()
        report("发出→手动录入页", manual_visible)
        # 保存空表单应提示
        click_btn(page, "button:has-text('保存当日记录')")
        time.sleep(0.8)
        toast = page.locator("#toast").inner_text()
        report("空表单保存提示", "至少填一项" in toast, toast)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 3. 店面管理
        click_btn(page, "button:has-text('店面管理')")
        time.sleep(1)
        panel = page.locator("#storeManagePanel").is_visible()
        report("店面管理面板打开", panel)
        click_btn(page, "button:has-text('新增店面')")
        time.sleep(0.5)
        page.fill("#sName0", "测试店X")
        time.sleep(0.3)
        click_btn(page, "button:has-text('保存修改')")
        time.sleep(1)
        toast = page.locator("#toast").inner_text()
        report("新增店面+保存", "保存" in toast, toast)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 4. 框名设置
        click_btn(page, "button:has-text('框名设置')")
        time.sleep(1)
        panel = page.locator("#goodsManagePanel").is_visible()
        report("框名设置面板", panel)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 5. 手动录入保存
        click_btn(page, "button:has-text('发出')")
        time.sleep(1)
        page.fill("#giIn0", "5")
        page.fill("#giIn1", "3")
        time.sleep(0.3)
        click_btn(page, "button:has-text('保存当日记录')")
        time.sleep(1.2)
        toast = page.locator("#toast").inner_text()
        report("手动录入保存", "成功" in toast, toast)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 6. 拍照识别（先进手动录入页，快捷录入卡片里有拍照识别）
        click_btn(page, "button:has-text('发出')")
        time.sleep(1.2)
        click_btn(page, "button:has-text('拍照识别')", timeout=10000)
        time.sleep(1.5)
        page.set_input_files("#photoAlbumInput", TEST_IMAGE)
        time.sleep(5)
        ocr_modal = page.locator("#ocrResultModal.show").count() > 0
        report("拍照识别弹窗", ocr_modal)
        if ocr_modal:
            rows = page.locator("#ocrEditFields tr").count()
            report("OCR结果行数>0", rows > 1, f"rows={rows}")
            # 关键：尝试点确认录入，看是否有 JS 错误（const 重赋值等）
            try:
                js_errors_before = len(errors)
                click_btn(page, "button:has-text('确认录入')")
                time.sleep(1.5)
                new_errors = errors[js_errors_before:]
                report("OCR确认录入无JS错误", len(new_errors) == 0, "; ".join(new_errors[:2])[:80] if new_errors else "OK")
            except Exception as e:
                report("OCR确认录入", False, str(e)[:60])
            # 取消（如果还在弹窗）
            try:
                click_btn(page, "button:has-text('取消')")
                time.sleep(0.3)
            except: pass
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 7. 历史记录页
        click_btn(page, ".tab:has-text('记录')")
        time.sleep(1.5)
        has_items = page.locator(".record-item").count() > 0
        report("历史记录显示", has_items, f"items={page.locator('.record-item').count()}")
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 8. 汇总页
        click_btn(page, "button:has-text('汇总')")
        time.sleep(1.5)
        summary_table = page.locator("#summaryTable").count() > 0
        report("汇总页表格", summary_table)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 9. 对账页
        click_btn(page, "button:has-text('对账')")
        time.sleep(1.2)
        reconcile = page.locator("#page-reconcile").is_visible()
        report("对账页打开", reconcile)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 10. 库存追踪
        click_btn(page, "button:has-text('库存追踪')")
        time.sleep(1)
        track = page.locator("#trackPanel").is_visible()
        report("库存追踪面板", track)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 11. 数据备份与恢复
        click_btn(page, "button:has-text('数据备份与恢复')")
        time.sleep(1.5)
        backup = page.locator("#backupPanel").is_visible()
        report("备份面板打开", backup)
        # 关闭教程弹窗
        click_btn(page, "button:has-text('×')") if page.locator("#backupTutorialModal.show").count() else None
        time.sleep(0.5)
        # 账号状态区
        acct = page.locator("#accountStatus").inner_text()
        report("账号状态区显示", "账号" in acct or "密码" in acct, acct[:50])
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 12. 设置密码弹窗
        click_btn(page, "button:has-text('数据备份与恢复')")
        time.sleep(1)
        click_btn(page, "#backupTutorialModal.show button:has-text('×')") if page.locator("#backupTutorialModal.show").count() else None
        time.sleep(0.3)
        click_btn(page, "button:has-text('设置账号密码')")
        time.sleep(0.8)
        setup_modal = page.locator("#setupModal.show").count() > 0
        report("设置密码弹窗", setup_modal)
        # 填错误手机号应提示
        page.fill("#setupPhone", "123")
        page.fill("#setupPwd", "abc12345")
        page.fill("#setupPwd2", "abc12345")
        click_btn(page, "button:has-text('设置密码')")
        time.sleep(0.8)
        toast = page.locator("#toast").inner_text()
        report("手机号校验", "手机号" in toast, toast)
        click_btn(page, "#setupModal.show button:has-text('取消')")
        time.sleep(0.3)
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 13. 管理员面板（❓连点10次）
        click_btn(page, "button:has-text('使用说明')")
        time.sleep(1.2)
        # 找到最后一条的❓连点10次
        zone = page.locator("#adminTapZone")
        for _ in range(10):
            zone.click()
            time.sleep(0.1)
        time.sleep(0.5)
        admin_modal = page.locator("#adminModal.show").count() > 0
        report("管理员面板(连点10次)", admin_modal)
        if admin_modal:
            page.fill("#adminKeyInput", "8023.520")
            page.dispatch_event("#adminKeyInput", "change")
            time.sleep(1.2)
            count = page.locator("#adminUserCount").inner_text()
            report("注册人数显示", count != "-", f"count={count}")
        page.goto(URL, wait_until="domcontentloaded"); time.sleep(1.5)

        # 14. 使用说明页内容
        click_btn(page, "button:has-text('使用说明')")
        time.sleep(1)
        settings = page.locator("#page-settings").inner_text()
        report("使用说明内容", "第0步" in settings and "常见问题" in settings)

        # 15. 最终JS错误检查
        report("全程无JS错误", len(errors) == 0, "; ".join(errors[:5]))

        context.close()
        browser.close()

    # 汇总
    print("\n" + "="*50)
    passed = sum(1 for r in results if r[1])
    print(f"通过 {passed}/{len(results)}")
    if passed < len(results):
        print("\n失败项:")
        for name, ok, detail in results:
            if not ok:
                print(f"  ❌ {name}: {detail}")
    return 0 if passed == len(results) else 1

if __name__ == "__main__":
    sys.exit(main())