const { chromium } = require('playwright');
const PAGE = 'file:///home/claude/expedition-form/index.html';

let pass = 0, fail = 0;
const failures = [];
function log(ok, label, extra) {
  if (ok) { pass++; } else { fail++; failures.push(label + (extra ? '  → ' + extra : '')); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra && !ok ? '  → ' + extra : ''}`);
}

function isoLocal(d){ const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
// วันที่อ้างอิงต้องคิดจาก "วันนี้ตามโซนเวลาของหน้าเว็บ" ไม่ใช่ของ Node
let TODAY = null;
function shift(years, days){ return new Date(TODAY[0]-years, TODAY[1], TODAY[2]+(days||0)); }

async function state(p, name){
  const cls = await p.getAttribute(`.field[data-name="${name}"]`, 'class');
  const msg = await p.textContent(`.field[data-name="${name}"] .msg`);
  return { valid: cls.includes('good') && !cls.includes('bad'), bad: cls.includes('bad'), msg: msg.trim() };
}

async function typeCheck(p, id, val, expectValid, label){
  await p.fill('#'+id, '');
  await p.fill('#'+id, val);
  await p.locator('#'+id).blur();
  await p.waitForTimeout(30);
  const s = await state(p, id);
  log(s.valid === expectValid, label || `${id} = ${JSON.stringify(val)} → ${expectValid ? 'valid' : 'invalid'}`, `got ${s.valid?'valid':'invalid'} "${s.msg}"`);
}

async function run(tz){
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1280,height:1000}, timezoneId: tz, locale:'th-TH' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const consoleErrs = []; p.on('console', m => {
    const t = m.text();
    if (m.type()==='error' && !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.(googleapis|gstatic)/.test(t)) consoleErrs.push(t);
  });
  await p.goto(PAGE);
  await p.waitForTimeout(300);
  TODAY = await p.evaluate(() => { const n = new Date(); return [n.getFullYear(), n.getMonth(), n.getDate()]; });

  console.log(`\n================ TIMEZONE: ${tz} ================`);

  console.log('\n--- ชื่อ-นามสกุล ---');
  await typeCheck(p,'fullname','',false);
  await typeCheck(p,'fullname','สมชาย',false);
  await typeCheck(p,'fullname','ก ข',false);
  await typeCheck(p,'fullname','สมชาย ใจดี',true);
  await typeCheck(p,'fullname','  สมชาย   ใจดี  ',true);
  await typeCheck(p,'fullname','John Smith',true);
  await typeCheck(p,'fullname',"Mary-Jane O'Neil",true);
  await typeCheck(p,'fullname','สมชาย ๑๒๓',false);
  await typeCheck(p,'fullname','สมชาย 123',false);
  await typeCheck(p,'fullname','สมชาย ใจดี!',false);
  await typeCheck(p,'fullname','ก'.repeat(50)+' '+'ข'.repeat(40),false);

  console.log('\n--- อีเมล ---');
  await typeCheck(p,'email','',false);
  await typeCheck(p,'email','abcexample.com',false);
  await typeCheck(p,'email','abc@abc',false);
  await typeCheck(p,'email','abc@abc.c',false);
  await typeCheck(p,'email','abc@abc.co',true);
  await typeCheck(p,'email','a..b@abc.com',false);
  await typeCheck(p,'email','.abc@abc.com',false);
  await typeCheck(p,'email','abc.@abc.com',false);
  await typeCheck(p,'email','abc@-abc.com',false);
  await typeCheck(p,'email','abc@abc..com',false);
  await typeCheck(p,'email','abc@abc.com.',false);
  await typeCheck(p,'email','a b@abc.com',false);
  await typeCheck(p,'email','first.last+tag@mail.example.co.th',true);
  await typeCheck(p,'email','a'.repeat(70)+'@abc.com',false);

  console.log('\n--- เบอร์โทรศัพท์ (10 หลักพอดี ขึ้นต้น 0) ---');
  await typeCheck(p,'phone','',false);
  await typeCheck(p,'phone','08123456',false);
  await typeCheck(p,'phone','081234567',false);          // เดิมเป็นบั๊ก
  await typeCheck(p,'phone','0812345678',true);
  await typeCheck(p,'phone','1812345678',false);
  await typeCheck(p,'phone','081-234-567',false);        // ขีดถูกกรอง เหลือ 9 หลัก
  await typeCheck(p,'phone','081234567890',true,'phone: พิมพ์ 12 หลัก → maxlength ตัดเหลือ 10 หลักที่ถูกต้อง');
  {
    const v = await p.inputValue('#phone');
    log(v === '0812345678', `phone maxlength ตัดเหลือ 10 หลัก (ค่าในช่อง = "${v}")`);
  }
  // แก้ค่าเกินขอบผ่าน DOM (ข้าม maxlength)
  await p.evaluate(() => { const el=document.querySelector('#phone'); el.value='08123456789'; el.dispatchEvent(new Event('blur')); });
  await p.waitForTimeout(40);
  log((await state(p,'phone')).bad, 'phone: ยัด 11 หลักผ่าน DOM → invalid');

  console.log('\n--- เลขบัตรประชาชน ---');
  await typeCheck(p,'natid','',false);
  await typeCheck(p,'natid','110170020725',false);
  await typeCheck(p,'natid','1101700207251',true);
  await typeCheck(p,'natid','1101700207250',false);
  await typeCheck(p,'natid','1111111111111',false);
  await typeCheck(p,'natid','0000000000000',false);
  await typeCheck(p,'natid','3100600445295',true);
  await typeCheck(p,'natid','1450991001120',true);

  console.log('\n--- วันเกิด (อายุ 18–80) ---');
  const dob = async (v, expectValid, label) => {
    await p.fill('#dob', v);
    await p.waitForTimeout(40);
    const s = await state(p,'dob');
    log(s.valid === expectValid, label || `dob=${v} → ${expectValid?'valid':'invalid'}`, `got ${s.valid?'valid':'invalid'} "${s.msg}"`);
  };
  await dob('', false, 'dob ว่าง → invalid');
  await dob(isoLocal(shift(-1)), false, 'วันในอนาคต → invalid');
  await dob(isoLocal(shift(18)),  true,  'อายุ 18 พอดีวันนี้ → valid');
  await dob(isoLocal(shift(18,1)), false, 'ครบ 18 พรุ่งนี้ (ขาด 1 วัน) → invalid');
  await dob(isoLocal(shift(18,-1)), true, 'ครบ 18 เมื่อวาน → valid');
  await dob(isoLocal(shift(17)),  false, 'อายุ 17 → invalid');
  await dob('2008-12-31', false, 'เกิดปลายปีของปีที่จะครบ 18 → invalid (บั๊กเดิม)');
  await dob(isoLocal(shift(80)),  true,  'อายุ 80 พอดี → valid');
  await dob(isoLocal(shift(81)),  false, 'อายุ 81 → invalid');
  await dob(isoLocal(shift(30)),  true,  'อายุ 30 → valid');

  console.log('\n--- รหัสผ่าน ---');
  await typeCheck(p,'pwd','',false);
  await typeCheck(p,'pwd','abcd123',false);
  await typeCheck(p,'pwd','abcd1234',true);
  await typeCheck(p,'pwd','abcdefgh',false);
  await typeCheck(p,'pwd','12345678',false);
  await typeCheck(p,'pwd','abcd 1234',false);
  await typeCheck(p,'pwd','a1'.repeat(33),true,'pwd: พิมพ์ 66 ตัว → maxlength ตัดเหลือ 64 ตัวที่ถูกต้อง');
  await p.evaluate(() => { const el=document.querySelector('#pwd'); el.value='a1'.repeat(33); el.dispatchEvent(new Event('blur')); });
  await p.waitForTimeout(40);
  log((await state(p,'pwd')).bad, 'pwd: ยัด 66 ตัวผ่าน DOM → invalid');
  await typeCheck(p,'pwd','Abcd1234!xyz',true);
  console.log('  (ยืนยันรหัสผ่าน)');
  await p.fill('#pwd','abcd1234');
  await typeCheck(p,'pwd2','',false);
  await typeCheck(p,'pwd2','abcd123',false);
  await typeCheck(p,'pwd2','abcd1234',true);
  await p.fill('#pwd','abcd12345');
  await p.waitForTimeout(40);
  log((await state(p,'pwd2')).bad, 'แก้รหัสผ่านหลังยืนยันแล้ว → ช่องยืนยันขึ้นเตือนทันที');
  await p.fill('#pwd2','abcd12345');
  await p.locator('#pwd2').blur();

  console.log('\n--- ไฟล์แนบ ---');
  const setFile = async (name, mime, bytes) => {
    await p.setInputFiles('#doc', { name, mimeType: mime, buffer: Buffer.alloc(bytes, 1) });
    await p.waitForTimeout(60);
    return state(p,'doc');
  };
  log((await state(p,'doc')).valid === false, 'ยังไม่แนบไฟล์ → invalid');
  log((await setFile('id.png','image/png',1024)).valid, 'PNG 1 KB → valid');
  log((await setFile('id.PDF','application/pdf',1024)).valid, 'นามสกุลตัวพิมพ์ใหญ่ .PDF → valid');
  log(!(await setFile('id.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1024)).valid, '.docx → invalid');
  log(!(await setFile('id.png','application/pdf',1024)).valid, 'นามสกุลไม่ตรงชนิดไฟล์จริง → invalid');
  log(!(await setFile('empty.png','image/png',0)).valid, 'ไฟล์ขนาด 0 ไบต์ → invalid');
  log((await setFile('big.png','image/png',2*1024*1024)).valid, 'ไฟล์ 2 MB พอดี → valid');
  log(!(await setFile('big.png','image/png',2*1024*1024+1)).valid, 'ไฟล์ 2 MB + 1 ไบต์ → invalid');
  await setFile('id.png','image/png',5000);
  log(await p.isVisible('#filechip.on'), 'แสดงชิปชื่อไฟล์หลังเลือกไฟล์');
  await p.click('#fileClear');
  await p.waitForTimeout(60);
  log(!(await p.isVisible('#filechip.on')) && (await state(p,'doc')).bad, 'ปุ่มลบไฟล์ทำงาน และกลับไปสถานะยังไม่แนบ');
  await setFile('id.png','image/png',5000);

  console.log('\n--- กลุ่มตัวเลือก / เงื่อนไข ---');
  for (const [group, val] of [['roles','นักวิจัย'],['regions','เอเชีย'],['contacts','อีเมล']]) {
    log((await state(p,group)).valid === false, `${group}: ยังไม่เลือก → invalid`);
    await p.click(`label.chip:has(input[name="${group}"][value="${val}"])`);
    await p.waitForTimeout(40);
    log((await state(p,group)).valid === true, `${group}: เลือกแล้ว → valid`);
    await p.click(`label.chip:has(input[name="${group}"][value="${val}"])`);
    await p.waitForTimeout(40);
    log((await state(p,group)).valid === false, `${group}: ยกเลิกการเลือก → กลับเป็น invalid`);
    await p.click(`label.chip:has(input[name="${group}"][value="${val}"])`);
  }

  console.log('\n--- ข้อมูลเพิ่มเติม (≤ 300) ---');
  await p.fill('#note','ก'.repeat(300));
  await p.locator('#note').blur(); await p.waitForTimeout(40);
  log((await state(p,'note')).valid, '300 ตัวอักษร → valid');
  log((await p.textContent('#noteCount')).trim() === '300 / 300', 'ตัวนับแสดง 300 / 300');
  await p.fill('#note','ก'.repeat(301));
  await p.locator('#note').blur(); await p.waitForTimeout(40);
  log((await state(p,'note')).bad, '301 ตัวอักษร → invalid');
  log((await p.locator('#noteCount').getAttribute('class')).includes('warn'), 'ตัวนับเปลี่ยนเป็นสีเตือน');
  await p.fill('#note','ทดสอบระบบ');
  await p.locator('#note').blur(); await p.waitForTimeout(40);

  console.log('\n--- สไลเดอร์ค่าตอบแทน ---');
  await p.fill('#salary','100'); await p.dispatchEvent('#salary','input'); await p.waitForTimeout(40);
  log((await p.textContent('#salaryVal')).trim() === '$100', 'ค่าต่ำสุด $100');
  await p.fill('#salary','5000'); await p.dispatchEvent('#salary','input'); await p.waitForTimeout(40);
  log((await p.textContent('#salaryVal')).trim() === '$5,000', 'ค่าสูงสุด $5,000');
  await p.evaluate(() => { const s=document.querySelector('#salary'); s.value='999999'; s.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(40);
  log((await p.textContent('#salaryVal')).trim() === '$5,000', 'แก้ค่าเกินขอบผ่าน DOM → ถูกจำกัดที่ $5,000');
  await p.fill('#salary','1200'); await p.dispatchEvent('#salary','input');

  console.log('\n--- เติมข้อมูลให้ถูกต้องครบทุกช่อง ---');
  await p.fill('#fullname','สมชาย ใจดี');
  await p.fill('#email','somchai@example.com');
  await p.fill('#phone','0812345678');
  await p.fill('#natid','1101700207251');
  await p.fill('#dob', isoLocal(shift(30)));
  await p.selectOption('#experience','mid');
  await p.fill('#pwd','abcd1234');
  await p.fill('#pwd2','abcd1234');
  await p.locator('#pwd2').blur();
  await p.waitForTimeout(80);

  console.log('\n--- เงื่อนไขและการส่งฟอร์ม ---');
  log((await state(p,'terms')).valid === false, 'ยังไม่ติ๊กเงื่อนไข → invalid');
  await p.click('#submitBtn'); await p.waitForTimeout(400);
  log(!(await p.isVisible('#veil.on')), 'กดส่งขณะยังไม่ติ๊กเงื่อนไข → ไม่ขึ้นหน้าสรุป');
  await p.click('label.checkline'); await p.waitForTimeout(60);
  log((await state(p,'terms')).valid, 'ติ๊กเงื่อนไขแล้ว → valid');
  log((await p.textContent('#pctText')).trim() === '100%', 'ความคืบหน้า 100%');
  const stepsDone = await p.locator('.steps li.done').count();
  log(stepsDone === 5, `รายการตรวจสอบครบ 5 หมวด (ได้ ${stepsDone})`);

  await p.click('#submitBtn'); await p.waitForTimeout(400);
  log(await p.isVisible('#veil.on'), 'ข้อมูลครบ → ขึ้นหน้าสรุป');
  const sum = await p.textContent('#summary');
  log(sum.includes('1101••••'), 'หน้าสรุปปิดบังเลขบัตรประชาชน');
  log(!sum.includes('1101700207251'), 'หน้าสรุปไม่แสดงเลขบัตรเต็ม');
  log(sum.includes('$1,200'), 'หน้าสรุปแสดงค่าตอบแทนตามสไลเดอร์');
  log(await p.evaluate(() => document.activeElement.id === 'closeModal'), 'โฟกัสย้ายไปปุ่มปิดหน้าต่าง');
  log(await p.isDisabled('#submitBtn'), 'ปุ่มส่งถูกปิดระหว่างเปิดหน้าสรุป (กันส่งซ้ำ)');
  await p.keyboard.press('Tab'); await p.waitForTimeout(60);
  log(await p.evaluate(() => document.activeElement.id === 'closeModal'), 'กด Tab แล้วโฟกัสยังอยู่ในหน้าต่าง');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  log(!(await p.isVisible('#veil.on')), 'กด Escape ปิดหน้าสรุปได้');
  log(!(await p.isDisabled('#submitBtn')), 'ปุ่มส่งกลับมาใช้งานได้หลังปิดหน้าสรุป');

  console.log('\n--- ล้างข้อมูล ---');
  await p.click('#clearBtn'); await p.waitForTimeout(300);
  log((await p.textContent('#pctText')).trim() === '0%', 'ความคืบหน้ากลับเป็น 0%');
  log((await p.locator('.field.bad').count()) === 0 && (await p.locator('.field.good').count()) === 0, 'ล้างสถานะและข้อความผิดพลาดหมด');
  log((await p.inputValue('#fullname')) === '' && (await p.inputValue('#note')) === '', 'ล้างค่าในช่องกรอก');
  log((await p.textContent('#salaryVal')).trim() === '$500', 'สไลเดอร์กลับค่าเริ่มต้น $500');
  log((await p.textContent('#noteCount')).trim() === '0 / 300', 'ตัวนับกลับเป็น 0 / 300');
  log(!(await p.isVisible('#filechip.on')), 'ล้างไฟล์แนบ');
  log((await p.locator('.steps li.done').count()) === 0, 'รายการตรวจสอบกลับเป็นยังไม่ผ่าน');
  log((await p.locator('#bars i.on1, #bars i.on2, #bars i.on3').count()) === 0, 'มิเตอร์รหัสผ่านรีเซ็ต');

  console.log('\n--- การเข้าถึง (Accessibility) ---');
  await p.click('#submitBtn'); await p.waitForTimeout(300);
  log((await p.getAttribute('#fullname','aria-invalid')) === 'true', 'ช่องที่ผิดถูกทำเครื่องหมาย aria-invalid');
  log((await p.getAttribute('#fullname','aria-describedby') || '').includes('fullname-msg'), 'ช่องกรอกผูกกับข้อความผิดพลาดด้วย aria-describedby');
  log(await p.evaluate(() => document.activeElement.id === 'fullname'), 'โฟกัสเลื่อนไปช่องแรกที่ผิด');
  log((await p.locator('.chips[role="group"]').count()) === 3, 'กลุ่ม checkbox ประกาศเป็น role=group ครบ 3 กลุ่ม');
  await p.fill('#fullname','สมชาย ใจดี'); await p.locator('#fullname').blur(); await p.waitForTimeout(60);
  log((await p.getAttribute('#fullname','aria-invalid')) === 'false', 'แก้ถูกแล้ว aria-invalid กลับเป็น false');

  console.log('\n--- responsive ---');
  await p.setViewportSize({width:375,height:800}); await p.waitForTimeout(200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  log(overflow <= 0, `ไม่มีสกอลล์แนวนอนที่ 375px (เกิน ${overflow}px)`);
  await p.setViewportSize({width:1280,height:1000});

  log(errs.length === 0, `ไม่มี JavaScript error (${errs.length})`, errs.join(' | '));
  log(consoleErrs.length === 0, `ไม่มี console error (${consoleErrs.length})`, consoleErrs.join(' | '));

  await b.close();
}

(async () => {
  await run('Asia/Bangkok');
  await run('America/Los_Angeles');
  console.log(`\n==================== สรุป ====================`);
  console.log(`ผ่าน ${pass} / ${pass+fail}   ไม่ผ่าน ${fail}`);
  if (fail) { console.log('\nรายการที่ไม่ผ่าน:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
})();
