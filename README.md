# PhantomTrace v2

Instagram takipçi / takip edilen listelerinin zaman içindeki değişimini **telefonda, yerelde** izleyen Android uygulaması.
Şifre girilmez; uygulama içindeki Instagram oturumun kullanılır. Veri yalnızca cihazdaki SQLite veritabanında durur, hiçbir sunucuya gönderilmez.

> v1 (bilgisayar + Flask sürümü) `legacy-flask/` klasöründe duruyor.

## APK nasıl alınır (bilgisayarda derleme gerekmez)
1. Repo'nun **Actions** sekmesine git → **Build APK** → **Run workflow**.
2. İş bitince (≈10-15 dk) çalışmanın sayfasındaki **Artifacts** bölümünden `PhantomTrace-apk` zip'ini indir.
3. Zip'ten çıkan `app-release.apk`'yı telefona at, kur (bilinmeyen kaynaklardan kuruluma izin ver).

## Kullanım
1. **Yeni tarama** → uygulama içinde Instagram'a giriş yap (test hesabı öneririm).
2. Taramak istediğin profile git; altta "Profil: @..." yazınca **Taramayı başlat**.
3. Tarama sürerken ekranı kapatma, uygulamadan çıkma (ekran açık kalır).
4. Bitince **Sonuç**'a bas. İlk tarama sadece başlangıç noktasıdır; farklar aynı profili tekrar taradığında görünür.

## Notlar ve riskler
- Uygulama Instagram'ın belgelenmemiş dahili web uç noktalarını kullanır; haber vermeden değişebilir.
- Otomatik veri çekme Instagram Kullanım Koşulları'na aykırıdır; hesap geçici kısıtlanabilir veya kapatılabilir. Ana hesabını riske atma.
- Başkalarının listelerini izlemek mahremiyet ve etik açıdan hassastır; yalnızca meşru amaçlarla ve kendi sorumluluğunda kullan.
- APK debug anahtarıyla imzalanır: kendi telefonuna kurulum içindir, Play Store'a uygun değildir.

## Geliştirme
```bash
npm install
npx expo start          # Expo Go WebView + SQLite için yeterli olmayabilir; development build gerekir
```
