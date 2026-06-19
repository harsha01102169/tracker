# Zenith Study Tracker 🚀 (Multi-User Cloud Upgrade)

Zenith is a modern, glassmorphic study tracking web app designed for **2 to 5 users** to log, schedule, and sync their study routines in their own private, cloud-synced accounts. 

---

## 🛠️ Step 1: Create a Free Supabase Cloud Database

Supabase provides the user accounts and database sync engine. It takes less than 2 minutes to set up for free:

1. Go to [Supabase](https://supabase.com/) and click **Start your project** to sign up for a free account.
2. Click **New Project** and name it something like `zenith-tracker`. Enter a secure database password, choose the nearest region, and select the **Free Tier**.
3. Once the database is ready (takes ~1 minute), navigate to the **SQL Editor** tab on the left sidebar:
   * Click **New Query**.
   * Copy the SQL block below, paste it into the editor, and click **Run** (at the top right).
   * This instantly sets up your tables and security policies.

```sql
-- 1. Create Tasks Table
CREATE TABLE public.tasks (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    duration INTEGER NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMPTZ,
    is_spontaneous BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Reflections Table
CREATE TABLE public.reflections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    date TEXT NOT NULL, -- YYYY-MM-DD
    focus_rating INTEGER NOT NULL,
    mood TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- 3. Create User Stats Table
CREATE TABLE public.user_stats (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    streak INTEGER DEFAULT 0,
    last_completed_date TEXT,
    current_date TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Enable Row Level Security (RLS) so users cannot read each other's data
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

-- 5. Create Security Policies
CREATE POLICY "Manage own tasks" ON public.tasks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Manage own reflections" ON public.reflections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Manage own stats" ON public.user_stats FOR ALL USING (auth.uid() = user_id);
```

4. Go to **Project Settings** (gear icon at bottom left) > **API**:
   * Copy the **Project URL**.
   * Copy the **`anon` `public` Key**.
   * Keep these safe! You will paste them into the app's setup page.

---

## 🌎 Step 2: Deploy Free on GitHub Pages

Hosting on GitHub Pages is free, secure, and auto-updates whenever you push code changes.

### Method A: Using GitHub Desktop (Easiest)
1. Download and open [GitHub Desktop](https://desktop.github.com/).
2. Click **Create New Repository on your Local Drive**:
   * **Name:** `study-tracker`
   * **Local Path:** Choose the parent folder where your scratch directory lives (`C:\Users\HARSHA VARDHAN\.gemini\antigravity\scratch`).
3. Copy the files (`index.html`, `styles.css`, `app.js`, `README.md`) from `zenith-study-tracker` and paste them into your new repository folder.
4. Open GitHub Desktop, write a commit summary (e.g. "initial commit"), click **Commit to main**, and then click **Publish repository** to upload it to GitHub as a public repo.
5. In your web browser, open your new repository on GitHub:
   * Go to **Settings** > **Pages** (on the left menu).
   * Under "Build and deployment" > "Source", select **Deploy from a branch**.
   * Under "Branch", select `main` (or `master`) and `/ (root)`, then click **Save**.
6. Wait 1 minute. GitHub will provide your live URL (e.g., `https://<your-username>.github.io/study-tracker/`).

### Method B: Using Git CLI
1. Open Git Bash or a terminal in `C:\Users\HARSHA VARDHAN\.gemini\antigravity\scratch\zenith-study-tracker`.
2. Run the following commands:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of study tracker"
   ```
3. Create a new public repository named `study-tracker` on [GitHub](https://github.com/).
4. Link and push your code:
   ```bash
   git remote add origin https://github.com/<your-username>/study-tracker.git
   git branch -M main
   git push -u origin main
   ```
5. Go to your repository settings on GitHub, select **Pages** from the sidebar, set the branch to `main`, and save!

---

## 🚀 Step 3: Connect and Share!
1. Open your published GitHub Pages URL on any computer, tablet, or mobile phone.
2. You will be greeted by the **Database Configuration** page. Paste your **Supabase URL** and **Anon Key** and click **Connect**.
3. Now, the Login/Register screen will appear!
   * Tell your 2-5 users to go to the website URL.
   * Each user clicks **Register** to create their email and password account.
   * Once logged in, everyone gets their own completely isolated, secure, and private study space!
4. The database credentials are saved inside each device's browser, so you only have to enter the URL/Key once per device.
