// 真實 Chromium 排版基準：固定情境逐一量測主要區塊，空資料不能以略過換綠燈。
import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedLayout, createBrowserFixture, visibleNav } from "../helpers/browser-fixtures.mjs";

const VIEWPORTS = [375, 768, 1280, 1440];

test("populated：四種寬度的頂欄、波段動作列、明細與成績單不互相遮擋", { timeout: 120_000 }, async () => {
  const fixture = await createBrowserFixture({ scenario: "populated" });
  try {
    const { page } = fixture;
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 1000 });
      await visibleNav(page, "strategy").click();
      await page.locator(".swing-card").first().waitFor({ state: "visible" });
      await page.evaluate(() => window.scrollTo(0, 0));
      const scoreFold = page.locator("#swingVerify details.sv-fold");
      if (await scoreFold.count() && !(await scoreFold.evaluate((node) => node.open))) {
        await scoreFold.evaluate((node) => { node.open = true; });
      }
      await page.locator("#swingVerify .sv-chip").first().waitFor({ state: "visible" });
      await assertExpectedLayout(page, { width });
      const measured = await page.evaluate(() => {
        const card = document.querySelector(".swing-card");
        return {
          bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          cardCount: document.querySelectorAll(".swing-card").length,
          longName: card?.querySelector(".swing-nm")?.textContent || "",
        };
      });
      assert.equal(measured.cardCount, 1, `${width}px fixture 應有且只有一張中軌卡`);
      assert.equal(measured.bodyFits, true, `${width}px body 不可橫向溢出`);
      assert.match(measured.longName, /環球晶圓先進材料科技/, `${width}px 長中文股票名不得被 fixture 省略`);
      if (width === 375 || width === 1280) await fixture.captureSnapshot(`layout-normal-${width}`);

      const opener = page.locator(".swing-open").first();
      await opener.click();
      await page.locator("#detailPanel.is-open").waitFor({ state: "visible" });
      await assertExpectedLayout(page, { width, detailOpen: true });
      const detail = await page.locator("#detailPanel").evaluate((node) => ({
        name: node.querySelector("#detailName")?.textContent || "",
        bodyFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      }));
      assert.match(detail.name, /環球晶圓先進材料科技/);
      assert.equal(detail.bodyFits, true, `${width}px 開明細後 body 不可橫向溢出`);
      await page.keyboard.press("Escape");
    }
  } catch (error) {
    await fixture.captureFailure("layout-smoke");
    throw error;
  } finally {
    await fixture.close();
  }
});

test("empty 與 partial：明確驗證零張卡及部分資料警告", { timeout: 60_000 }, async (t) => {
  await t.test("empty 恰為零張卡且顯示空狀態", async () => {
    const fixture = await createBrowserFixture({ scenario: "empty" });
    try {
      await visibleNav(fixture.page, "strategy").click();
      await fixture.page.getByText(/收盤的掃描沒有符合「中軌攻防」的標的/).waitFor();
      assert.equal(await fixture.page.locator(".swing-card").count(), 0);
    } catch (error) {
      await fixture.captureFailure("layout-empty");
      throw error;
    } finally {
      await fixture.close();
    }
  });

  await t.test("partial 保留一張真卡並揭露資料不完整", async () => {
    const fixture = await createBrowserFixture({ scenario: "partial" });
    try {
      await visibleNav(fixture.page, "strategy").click();
      await fixture.page.locator(".swing-card").waitFor();
      assert.equal(await fixture.page.locator(".swing-card").count(), 1);
      await fixture.page.locator("#strategyBoard").getByText(/部分市場資料暫缺/).waitFor();
    } catch (error) {
      await fixture.captureFailure("layout-partial");
      throw error;
    } finally {
      await fixture.close();
    }
  });
});


test("CV1/I1/M1：隔日新母體四尺寸及200%字體，逐欄門檻與展開內容可用", { timeout:120_000 }, async () => {
  const fixture = await createBrowserFixture({scenario:'populated'});
  try {
    const {page}=fixture;
    await page.locator('[data-overnight-view="performance"]').click();
    await page.locator('.verify-history').waitFor();
    const payloads=await page.evaluate(async()=>Promise.all(['/api/overnight/verify/history','/api/swing/verify'].map(async url=>(await fetch(url)).json())));
    for (const payload of payloads) for (const model of payload.cohort.models) {
      assert.equal(model.issued,model.noEntry+model.pending+model.resolved+model.unresolved,'issued四狀態等式');
      assert.equal(model.modelKey,JSON.stringify(model.identity),'完整identity與modelKey一致');
      for (const m of Object.values(model.metricCoverage)) {
        assert.equal(m.totalCount,m.validCount+m.missingCount);
        assert.equal(Number.isFinite(m.value),m.validCount>0,'raw metric不因顯示門檻變null');
      }
    }
    const immatureDisplay=payloads[1].cohort.headline.scenarios[1];
    assert.equal(immatureDisplay.netProfitRate,null);
    assert.equal(immatureDisplay.metricCoverage.netProfitRate.value,50,'18筆raw值保留，顯示率仍未達20筆');
    assert.equal(await page.locator('.verify-history-row:not(.is-head) > span').first().textContent(),'08/03→08/04','fixture日期形狀需與真API ISO一致');
    const selectors=['.verify-history header strong','.verify-stats > span','.verify-history-row.is-head','.verification-denominators > summary'];
    for (const width of VIEWPORTS) for (const factor of [1,2]) {
      await page.setViewportSize({width,height:1000});
      await fixture.emulateTextZoom(factor,selectors);
      const stats=page.locator('.verify-stats');
      assert.match(await stats.textContent(),/開盤觀察淨獲利率 累積中 1\/20 天/);
      assert.match(await stats.textContent(),/收盤觀察淨獲利率 0%/);
      assert.match(await stats.textContent(),/曾達\+2% 累積中 19\/20 天/);
      assert.match(await stats.textContent(),/曾破−2% --/);
      assert.equal(await stats.locator('.positive,.negative').count(),0);
      await stats.scrollIntoViewIfNeeded();
      await fixture.captureSnapshot(`overnight-headline-${width}-text${factor*100}`);
      const summary=page.locator('.verification-denominators > summary');
      await summary.focus(); await page.keyboard.press('Enter');
      assert.equal(await summary.evaluate(n=>n.parentElement.open),true);
      assert.equal(await summary.evaluate(n=>n===document.activeElement),true);
      const details=page.locator('.verification-denominators');
      assert.match(await details.textContent(),/採集 20\/21/);
      assert.match(await details.textContent(),/開盤觀察淨獲利率：累積中 1\/20 天；有效 1\/20/);
      assert.match(await details.textContent(),/收盤觀察淨獲利率：0%/);
      const geometry=await page.evaluate(()=>{
        const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        return {width:innerWidth,bodyFits:document.documentElement.scrollWidth<=document.documentElement.clientWidth,
          blocks:['.verify-history header','.verify-stats','.verification-denominators'].map(s=>rect(document.querySelector(s))),
          rates:[...document.querySelectorAll('.verify-stats > span')].map(rect)};
      });
      const cellOverflow=await page.locator('.verify-history-row').evaluateAll(rows=>rows.flatMap(row=>[...row.children].flatMap(cell=>{
        const range=document.createRange();range.selectNodeContents(cell);const box=cell.getBoundingClientRect();
        return [...range.getClientRects()].filter(rect=>rect.left<box.left-1||rect.right>box.right+1).map(()=>cell.textContent);
      })));
      assert.deepEqual(cellOverflow,[],`${width}/${factor}每日明細字形不得侵入相鄰欄位`);
      assert.equal(geometry.bodyFits,true,`${width}/${factor} body不橫溢`);
      for (const r of geometry.blocks) assert.ok(r.width>0&&r.height>0&&r.left>=-1&&r.right<=width+1,`${width}/${factor}主摘要與分母需在viewport內 ${JSON.stringify(r)}`);
      for (let i=0;i<geometry.rates.length;i++) for (let j=i+1;j<geometry.rates.length;j++) {
        const a=geometry.rates[i],b=geometry.rates[j];
        assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,`${width}/${factor}比率文字不重疊`);
      }
      await summary.scrollIntoViewIfNeeded();
      await fixture.captureSnapshot(`overnight-measurement-${width}-text${factor*100}`);
      await summary.focus(); await page.keyboard.press('Enter');
      assert.equal(await summary.evaluate(n=>n.parentElement.open),false);
      assert.equal(await summary.evaluate(n=>n===document.activeElement),true);
    }
  } catch(error) {await fixture.captureFailure('overnight-measurement');throw error;}
  finally {await fixture.close();}
});
