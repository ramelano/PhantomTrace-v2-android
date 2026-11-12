# PhantomTrace

Instagram takipçi / takip edilen listelerinin zaman içindeki değişimini lokal olarak izler.
Şifre girilmez; tarayıcıda açık oturumun kullanılır. Veri yalnızca `127.0.0.1` üzerindeki Flask sunucusuna gider.

## Kurulum ve başlatma
```bash
cd phantomtrace
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py                                        # http://127.0.0.1:5000
```

## Kullanım
1. Tarayıcıda instagram.com'a giriş yap, taramak istediğin profile git.
2. F12 > Console. İlk seferde Chrome yapıştırmaya izin vermek için `allow pasting` yazmanı isteyebilir.
3. `phantom_script.js` içeriğini yapıştır, Enter. Konsolda ilerleme görünür (aralarda rastgele beklemeler vardır).
4. Bitince veri otomatik gönderilir; `http://127.0.0.1:5000` adresinden profili aç.
5. Farkları görmek için aynı profili daha sonra tekrar tara (ilk tarama sadece başlangıç noktasıdır).

Durdurmak: konsolda `window.__phantomStop = true`

## Sorun giderme
- **Veri sunucuya ulaşmadı:** Instagram'ın CSP'si veya Chrome'un yerel ağ izni isteği engellemiş olabilir. Script otomatik olarak bir `.json` dosyası indirir; dashboard'daki "Manuel yükleme" ile yükle.
- **429 / 403:** Instagram hız sınırı koydu. Bir süre bekle, `CONFIG` içindeki gecikmeleri artır.
- **Liste eksik uyarısı:** Çok büyük hesaplarda Instagram tüm listeyi vermeyebilir; bu durumda farklar güvenilir olmaz.
- **Endpoint değişimi:** Script Instagram'ın belgelenmemiş dahili web uç noktalarını kullanır; Instagram bunları haber vermeden değiştirebilir.

## Uyarılar
- Otomatik veri çekme Instagram Kullanım Koşulları'na aykırıdır; hesabın geçici kısıtlanabilir veya kapatılabilir. Ana hesabını riske atma, gecikmeleri düşürme.
- Başkalarının listelerini izlemek mahremiyet ve etik açıdan hassastır; yalnızca meşru amaçlarla kullan.
- `phantomtrace.db` dosyası taranan kullanıcıların listelerini içerir; paylaşma, GitHub'a yükleme (`.gitignore`'a ekle).
