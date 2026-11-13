# 3D dars xonasi (v3)

Asos: v2 "Maruza zali" (podium, oyna, soat, javon, yuz/soch xilma-xilligi, eshikdan kirib o'tirish) + quyidagilar:

- **Oflayn 3D zaxira**: Three.js (CDN: cdnjs → jsDelivr → unpkg) yuklanmasa yoki WebGL ishlamasa, Canvas perspektiv xona ochiladi (partalar, doska, ustoz, o'quvchilar, bosib o'tirish/chat).
  Mutlaq oflayn uchun `three.min.js` (r128) ni `public/lib/three.min.js` ga qo'ying.
- **Sifat tanlagichi** (Auto / Tez / Sifat): FPS va piksel zichligi.
- **2D reja** — xonaga tepadan qarash: doska (xona nomi, kod, hozirgi fayl), ustoz, partalar, oynalar, eshik. Yoningizdagi chap/o'ng odam "◀ chap / o'ng ▶" belgisi bilan ajratiladi; istalgan odamni bosib shaxsiy xabar yozish mumkin.
- Pastdagi ◀ / ▶ tugmalari: yoningizdagi odamga xabar yozadi va kamera shu tomonga buriladi.

Ishga tushirish: `npm install && npm start` → Transmitter xonaga kirib, "☰ Funksiyalar" menyusidagi "🏫 3D dars xonasi" tugmasini yoqadi. Transmitterga 3D umumiy xona ko'rinishi, Receiverga esa o'rindiq tanlash rejasi ochiladi. Receiver bo'sh o'rindiqni tanlaydi; o'tirgach POV ko'rinishiga o'tadi. Receiver 3D oynani yopib, keyin "🏫 3D xonani ochish" tugmasi yoki pastki o'ngdagi 3D tugmasidan qayta ochishi mumkin. Transmitter 3D mode'ni o'chirsa, hamma uchun yopiladi.
