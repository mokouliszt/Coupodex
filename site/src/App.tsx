import {
  Download,
  Github,
  ScanLine,
  MessagesSquare,
  Search,
  Clock3,
  Undo2,
  ShieldCheck,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { APK, REPO, RELEASES, VERSION, Phone, Section, asset } from "@/components/common";

export default function App() {
  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Install />
        <Notes />
      </main>
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-content items-center justify-between px-5">
        <a href="#top" className="flex min-h-[44px] items-center gap-2.5">
          <img src={asset("icon.png")} alt="" width={30} height={30} className="rounded-[8px]" />
          <span className="text-[17px] font-black tracking-tight">Coupodex</span>
        </a>
        <nav className="flex items-center gap-1 md:gap-2">
          <a href="#features" className="hidden px-3 py-2 text-[14px] text-ink/60 hover:text-ink sm:block">
            機能
          </a>
          <a href="#how" className="hidden px-3 py-2 text-[14px] text-ink/60 hover:text-ink sm:block">
            仕組み
          </a>
          <a href="#install" className="hidden px-3 py-2 text-[14px] text-ink/60 hover:text-ink sm:block">
            導入
          </a>
          <Button href={REPO} size="sm" variant="outline" target="_blank" rel="noreferrer">
            <Github size={16} />
            GitHub
          </Button>
        </nav>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden px-5 pb-8 pt-14 md:pb-20 md:pt-24">
      {/* 地の右上にオレンジのにじみ */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-52 h-[520px] w-[520px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(242,87,13,.14), transparent)" }}
      />
      <div className="relative mx-auto grid max-w-content items-center gap-12 md:grid-cols-[1.05fr_auto] md:gap-8">
        <div className="reveal">
          <Badge className="mb-5">
            <Sparkles size={13} />
            オープンソース・広告なし
          </Badge>
          <h1 className="text-[38px] font-black leading-[1.24] tracking-tight md:text-[54px]">
            紙のクーポン、
            <br />
            <span className="text-orange">使い切る。</span>
          </h1>
          <p className="mt-6 max-w-xl text-[16px] leading-[1.95] text-ink/60 md:text-[17px]">
            財布やグローブボックスに溜まった券を、撮るだけで一覧に。
            店舗名・サービス内容・保管場所・使用期限・メモをまとめて読み取ります。
            あとは「駐車場に着いたけど何か使える?」と聞くだけです。
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button href={APK} size="lg">
              <Download size={19} />
              APK をダウンロード
            </Button>
            <Button href={RELEASES} size="lg" variant="outline" target="_blank" rel="noreferrer">
              リリース一覧
            </Button>
          </div>

          <p className="mt-5 font-mono text-[12.5px] text-ink/40">
            {VERSION} ・ Android 8.0 以上 ・ 約3.4MB ・ 無料 ・ MIT License
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink/40">
            読み取りには ChatGPT の有効なサブスクリプションが必要です。
          </p>
        </div>

        <div className="reveal flex justify-center md:justify-end" style={{ animationDelay: "120ms" }}>
          <div className="relative">
            {/* アイコンと同じスキャン枠でスクショを囲う */}
            <div aria-hidden className="reticle absolute -inset-5 hidden md:block">
              <span />
              <span />
              <span />
              <span />
            </div>
            <Phone
              src="screenshots/list.png"
              alt="クーポン一覧の画面"
              priority
              className="floaty md:!max-w-[320px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const SMALL = [
  {
    icon: Search,
    title: "3通りの探し方",
    body: "キーワード、あいまい検索、会話。あいまい検索は全半角・カタカナ/ひらがな・打ち間違いを吸収します。",
  },
  {
    icon: Clock3,
    title: "期限が近い順に並ぶ",
    body: "使用済み・期限切れは彩度を落として末尾へ。「まもなく」で絞れば、今週なくなる券だけが残ります。",
  },
  {
    icon: Undo2,
    title: "取り消せる削除",
    body: "確認ダイアログの代わりに5秒の猶予。長押しか ⋯ から消して、間違えたら元に戻せます。写真ごと復元します。",
  },
  {
    icon: ShieldCheck,
    title: "端末の中だけ",
    body: "クーポンも写真も端末内にのみ保存。アカウント登録も、専用サーバーも、トラッキングもありません。",
  },
];

function Features() {
  return (
    <Section
      id="features"
      eyebrow="Features"
      title={
        <>
          撮る、探す、使い切る。
          <br />
          そのための3画面。
        </>
      }
      lead="紙の券を撮って貯めるところから、店の前で「これ使える?」を解決するところまで。"
      className="border-t border-line bg-white"
    >
      <div className="space-y-20 md:space-y-28">
        <Feature
          shot="screenshots/scan.png"
          alt="クーポンを取り込む画面"
          eyebrow="Scan"
          title="撮れば、5項目が埋まる"
          body={
            <>
              券面を1枚撮ると、Codex が画像を読んで構造化します。5項目に加えて、カテゴリ・割引の要点・
              利用条件・クーポンコード・店舗住所・緯度経度まで拾います。
              チェーン店と判断できた場合は、web 検索で公式の住所と座標を補完します。
            </>
          }
          points={[
            "「発行日から3ヶ月」のような相対表記は日付に正規化。券面の原文も残します",
            "確度が低いフィールドには「要確認」が付き、必要なときだけ質問が1つ出ます",
            "読み取れなかった項目を推測で埋めることはありません",
          ]}
        />

        <Feature
          reverse
          shot="screenshots/chat-answer.png"
          alt="AI検索で近くのクーポンを尋ねた画面"
          eyebrow="AI Search"
          title="話しかけて探す"
          body={
            <>
              登録済みの全件と現在地を渡した上での対話検索です。
              「昼メシを安くしたい」のような曖昧な指定でも、絞りすぎずに候補を返します。
              該当するクーポンはカードで並ぶので、そのまま開いて使えます。
            </>
          }
          points={[
            "現在地から歩ける距離（既定 500m・200m〜3kmで調整可）で絞り込み",
            "券面に載っていない営業時間や臨時休業は web 検索で補います",
            "期限切れは原則すすめません。すすめる場合は明示します",
          ]}
        />

        <Feature
          shot="screenshots/actions.png"
          alt="カードの操作メニュー"
          eyebrow="Manage"
          title="券のまま、手早く片付ける"
          body={
            <>
              一覧のカードは券面の形をしています。下半分の半券には期限・距離・保管場所。
              長押しか半券右端の ⋯ から、使用済み・編集・地図・共有・削除をその場で実行できます。
            </>
          }
          points={[
            "使ったら「使ったことにする」。間違えても取り消せます",
            "保存後もすべての項目を編集できます",
            "地図はチェーン店なら店舗検索、座標があればその地点を直接開きます",
          ]}
        />
      </div>

      <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 md:mt-28">
        {SMALL.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-orange/10 text-orange">
              <Icon size={20} />
            </div>
            <CardTitle>{title}</CardTitle>
            <CardBody>{body}</CardBody>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function Feature({
  shot,
  alt,
  eyebrow,
  title,
  body,
  points,
  reverse,
}: {
  shot: string;
  alt: string;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  points: string[];
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={reverse ? "md:order-2" : ""}>
        <div className="eyebrow mb-3 text-orange">{eyebrow}</div>
        <h3 className="text-[24px] font-black leading-snug tracking-tight md:text-[30px]">{title}</h3>
        <p className="mt-4 text-[15px] leading-[1.95] text-ink/60 md:text-[16px]">{body}</p>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-[14.5px] leading-[1.8]">
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-orange" />
              <span className="text-ink/70">{p}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={`flex justify-center ${reverse ? "md:order-1 md:justify-start" : "md:justify-end"}`}>
        <Phone src={shot} alt={alt} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function HowItWorks() {
  return (
    <Section
      id="how"
      eyebrow="How it works"
      title="鍵も、サーバーも要らない。"
      lead="読み取りと検索は、利用者自身の ChatGPT サブスクリプション枠（Codex）を使って端末内で完結します。開発者側のサーバーを経由しないので、預ける先はあなたのアカウントだけです。"
    >
      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            n: "01",
            t: "ChatGPT にログイン",
            b: "初回だけ、アプリ内から自分の ChatGPT アカウントで認証します。APIキーの発行も入力も不要です。",
          },
          {
            n: "02",
            t: "券を撮る",
            b: "撮った画像はその場で解析にかけられ、結果を確認・編集してから端末内に保存されます。",
          },
          {
            n: "03",
            t: "聞いて使う",
            b: "店の前で「この辺で使えるやつある?」。手持ちと現在地を踏まえて答えが返ります。",
          },
        ].map((s) => (
          <div key={s.n} className="ticket p-6 pb-7" style={{ ["--notch" as never]: "58px" }}>
            <div className="font-mono text-[26px] font-bold text-orange/25">{s.n}</div>
            <h3 className="mt-1 text-[17px] font-bold tracking-tight">{s.t}</h3>
            <p className="mt-2 text-[14.5px] leading-[1.85] text-ink/60">{s.b}</p>
            <div className="perf mt-5 pt-4">
              <span className="eyebrow text-ink/40">Step {s.n}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-line bg-white p-6 md:p-8">
        <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
          <Fact label="外部へ出るもの" value="解析時の券面画像とクーポンのテキスト、許可した場合の緯度経度" />
          <Fact label="保存先" value="端末内（filesDir）のみ。外部同期なし" />
          <Fact label="宛先" value="あなたの ChatGPT アカウントのみ" />
        </div>
      </div>
    </Section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[220px] flex-1">
      <div className="eyebrow mb-1.5 text-orange">{label}</div>
      <p className="text-[14px] leading-[1.8] text-ink/70">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Install() {
  return (
    <Section
      id="install"
      eyebrow="Install"
      title="Google Play では配信していません。"
      lead="APK を直接インストールします。以降の更新も同じ手順で上書きできます。"
      className="border-t border-line bg-white"
    >
      <div className="grid gap-8 md:grid-cols-[1fr_auto] md:gap-16">
        <ol className="space-y-7">
          {[
            {
              t: "APK をダウンロード",
              b: "下のボタンから最新版のファイルを端末に保存します。",
            },
            {
              t: "インストールを許可",
              b: "初回のみ「この提供元のアプリを許可」を求められたら有効にします。",
            },
            {
              t: "起動して ChatGPT にログイン",
              b: "最初の画面でログインすると、以降はその枠で読み取りと検索が動きます。",
            },
          ].map((s, i) => (
            <li key={s.t} className="flex gap-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orange font-mono text-[14px] font-bold text-white">
                {i + 1}
              </span>
              <div className="pt-1">
                <h3 className="text-[16px] font-bold">{s.t}</h3>
                <p className="mt-1.5 text-[14.5px] leading-[1.85] text-ink/60">{s.b}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="ticket w-full max-w-[360px] self-start p-7 md:w-[360px]">
          <div className="eyebrow mb-3 text-orange">Download</div>
          <div className="text-[21px] font-black tracking-tight">Coupodex {VERSION}</div>
          <p className="mt-2 font-mono text-[12.5px] text-ink/40">Android 8.0 以上 ・ 約3.4MB</p>
          <Button href={APK} size="lg" className="mt-6 w-full">
            <Download size={19} />
            APK をダウンロード
          </Button>
          <div className="perf mt-6 pt-3">
            <a
              href={RELEASES}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[44px] items-center justify-between text-[14px] text-ink/60 hover:text-orange"
            >
              過去のリリース <ArrowRight size={15} />
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[44px] items-center justify-between text-[14px] text-ink/60 hover:text-orange"
            >
              ソースコードを見る <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </div>

      <div className="mt-16 grid gap-4 sm:grid-cols-2">
        <Card className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange/10 text-orange">
            <ScanLine size={20} />
          </div>
          <div>
            <CardTitle>自分でビルドする</CardTitle>
            <CardBody>
              webui を先にビルドしてから Gradle を回します。手順は README に書いてあります。
            </CardBody>
          </div>
        </Card>
        <Card className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange/10 text-orange">
            <MessagesSquare size={20} />
          </div>
          <div>
            <CardTitle>不具合・要望</CardTitle>
            <CardBody>
              読み取りが崩れた券があれば、どんな表記だったかを Issue で教えてもらえると助かります。
            </CardBody>
          </div>
        </Card>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function Notes() {
  return (
    <Section eyebrow="Notes" title="ご利用にあたって">
      <ul className="max-w-3xl space-y-4 text-[14.5px] leading-[1.95] text-ink/60">
        {[
          "本アプリは個人が開発したものです。OpenAI および ChatGPT の提供元とは関係ありません。",
          "ChatGPT の Codex backend を直接利用しているため、先方の仕様変更により動作しなくなる可能性があります。利用にあたっては OpenAI の利用規約をご自身でご確認ください。",
          "読み取り結果には誤りが含まれる場合があります。使用期限や利用条件の最終確認は、券面の現物でお願いします。",
          "日本語の紙クーポン以外は想定していません。",
        ].map((t) => (
          <li key={t} className="flex gap-3">
            <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink/20" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="border-t border-line px-5 py-12">
      <div className="mx-auto flex max-w-content flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <img src={asset("icon.png")} alt="" width={34} height={34} className="rounded-[9px]" />
          <div>
            <div className="text-[15px] font-bold tracking-tight">Coupodex</div>
            <div className="font-mono text-[11.5px] text-ink/40">MIT License · © 2026 mokouliszt</div>
          </div>
        </div>
        <div className="-mx-2 flex items-center gap-1 text-[14px]">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center gap-1.5 px-3 text-ink/60 hover:text-orange"
          >
            <Github size={16} />
            GitHub
          </a>
          <a
            href={RELEASES}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center px-3 text-ink/60 hover:text-orange"
          >
            リリース
          </a>
          <a
            href={`${REPO}/issues`}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center px-3 text-ink/60 hover:text-orange"
          >
            Issues
          </a>
        </div>
      </div>
    </footer>
  );
}
