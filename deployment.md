# دليل النشر التفصيلي

## الخيار 1: خادم شخصي / VPS مباشرة

1. انسخ مجلد المشروع كاملًا إلى الخادم (عبر `scp` أو `git`).
2. تأكد من تثبيت Node.js 22.5+ على الخادم:
   ```bash
   node -v
   ```
3. شغّل التطبيق:
   ```bash
   cd silah
   node server/app.js
   ```
4. اضبط جدار الحماية (Firewall) للسماح بالمنفذ 3000 (أو استخدم Nginx كوسيط — انظر أدناه).

### إبقاء الخدمة تعمل دائمًا (systemd)

أنشئ ملف `/etc/systemd/system/silah.service`:

```ini
[Unit]
Description=Silah Genealogy App
After=network.target

[Service]
Type=simple
User=silah
WorkingDirectory=/opt/silah
ExecStart=/usr/bin/node server/app.js
Restart=on-failure
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

ثم:
```bash
sudo systemctl daemon-reload
sudo systemctl enable silah
sudo systemctl start silah
sudo systemctl status silah
```

### وسيط عكسي (Reverse Proxy) بـ Nginx مع HTTPS

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

لإضافة HTTPS مجانًا استخدم Certbot (Let's Encrypt):
```bash
sudo certbot --nginx -d your-domain.com
```

## الخيار 2: Docker

```bash
docker build -t silah .
docker run -d -p 3000:3000 -v silah_data:/app/data --name silah --restart unless-stopped silah
```

البيانات محفوظة في الحجم (Volume) `silah_data` وتبقى محفوظة عند إعادة تشغيل الحاوية.

## الخيار 3: مزوّدات استضافة تدعم Node.js مباشرة (Render / Railway / Fly.io)

هذه المنصات توفر مستويات مجانية أو منخفضة التكلفة تكفي للبدء:

1. ادفع المشروع إلى مستودع Git (GitHub/GitLab).
2. أنشئ خدمة جديدة من نوع "Web Service" وأشر إلى المستودع.
3. أمر البدء (Start Command): `node server/app.js`
4. لا حاجة لأي متغيرات بيئة إضافية إلزامية (المنفذ يُحدَّد تلقائيًا عبر `PORT`
   الذي توفره هذه المنصات عادة — الكود يقرأه تلقائيًا).
5. **مهم**: تأكد أن الخدمة توفر Persistent Disk/Volume لمسار `data/` وإلا فستُفقد
   قاعدة البيانات SQLite عند كل إعادة نشر. إن كانت المنصة لا توفر تخزينًا دائمًا
   مجانيًا، استخدم خيار VPS أو Docker مع Volume بدلاً من ذلك.

## النسخ الاحتياطي الدوري

أبسط نسخة احتياطية هي نسخ ملف قاعدة البيانات نفسه (وهو ملف SQLite واحد):

```bash
cp data/silah.db backups/silah-$(date +%Y%m%d-%H%M%S).db
```

يمكن جدولة هذا عبر `cron`:
```
0 3 * * * cp /opt/silah/data/silah.db /opt/silah/backups/silah-$(date +\%Y\%m\%d).db
```

## قائمة تحقق ما قبل الإنتاج

- [ ] غيّر أي بيانات دخول تجريبية (`seed.js`) أو لا تُشغّل الـ seed أصلًا في الإنتاج.
- [ ] فعّل HTTPS (عبر Nginx + Certbot أو ما يعادلها لدى مزوّد الاستضافة).
- [ ] تأكد من وجود تخزين دائم (Persistent Volume) لمجلد `data/`.
- [ ] فعّل نسخًا احتياطية دورية لملف `data/silah.db`.
- [ ] شغّل `npm test` قبل كل نشر جديد للتأكد من عدم كسر شيء.
