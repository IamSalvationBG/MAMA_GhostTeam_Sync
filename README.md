# MAMA Ghost Team Daily Sync 🚀

Automated daily synchronizer and public CDN data distribution repository for **Mega Auto Matrix Assault**.

## 🌐 Public CDN Endpoint
The latest ghost teams pool is distributed worldwide via jsDelivr CDN:

```
https://cdn.jsdelivr.net/gh/IamSalvationBG/MAMA_GhostTeam_Sync@main/ghost-pool.json
```

## ⚙️ How It Works
1. Runs once every day via GitHub Actions at 07:37 UTC (shortly after the daily Firestore quota reset).
2. Reads up to 245 recent and historic player team snapshots from Cloud Firestore.
3. Updates `ghost-pool.json` across Rounds 1 to 35.
4. Auto-commits and pushes the updated dataset back to `main`.
5. Web game clients fetch the updated pool instantly with 0 Firestore reads and 0 server redeploys required!
