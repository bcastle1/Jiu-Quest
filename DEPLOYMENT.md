# JiuQuest Deployment

## GitHub Pages

This app is configured for GitHub Pages with the custom domain:

```text
jiuquest.com
```

The app ships `public/CNAME`, so Vite copies `CNAME` into `dist/` during build. The GitHub Actions workflow in `.github/workflows/deploy-pages.yml` builds the React app and deploys `dist` to GitHub Pages on every push to `main`.

## Required GitHub Settings

1. Create or open the GitHub repository for this project.
2. Push the local repo to the `main` branch.
3. Go to `Settings -> Pages`.
4. Set `Build and deployment` to `GitHub Actions`.
5. Set the custom domain to `jiuquest.com`.
6. After DNS validates and the certificate is issued, turn on `Enforce HTTPS`.

GitHub says DNS propagation can take up to 24 hours, and custom-domain HTTPS can take time to provision after the records are correct.

## Namecheap DNS Records

For apex domain hosting at `jiuquest.com`, add these host records in Namecheap Advanced DNS.

```text
Type   Host  Value                         TTL
A      @     185.199.108.153               Automatic
A      @     185.199.109.153               Automatic
A      @     185.199.110.153               Automatic
A      @     185.199.111.153               Automatic
AAAA   @     2606:50c0:8000::153           Automatic
AAAA   @     2606:50c0:8001::153           Automatic
AAAA   @     2606:50c0:8002::153           Automatic
AAAA   @     2606:50c0:8003::153           Automatic
CNAME  www   <github-user-or-org>.github.io Automatic
```

Replace `<github-user-or-org>` with the account or organization that owns the Pages repository.

Remove conflicting URL Redirect, Parking, extra A, extra AAAA, or duplicate `www` CNAME records for the same host. Extra records can block GitHub Pages verification and certificate provisioning.

## Browser Security

The public site stops showing "Not secure" after:

1. GitHub Pages custom domain is set to `jiuquest.com`.
2. Namecheap DNS points to GitHub Pages.
3. GitHub provisions the certificate.
4. `Enforce HTTPS` is enabled in GitHub Pages.

## Email Security Records

DMARC, SPF, and DKIM protect email sent from the domain. They do not control the browser padlock.

If `jiuquest.com` will not send or receive email yet, a defensive no-mail setup is:

```text
Type  Host    Value
TXT   @       v=spf1 -all
TXT   _dmarc  v=DMARC1; p=reject; adkim=s; aspf=s
MX    @       0 .
```

If the domain will send email through Google Workspace, Namecheap Private Email, Mailchimp, SendGrid, or another provider, use that provider's SPF and DKIM records instead, then keep DMARC aligned with the sending setup.
