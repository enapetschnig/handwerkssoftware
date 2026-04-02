# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - region "Notifications (F8)":
      - list [ref=e4]:
        - status [ref=e5]:
          - generic [ref=e6]:
            - generic [ref=e7]: Fehler beim Anmelden
            - generic [ref=e8]: Invalid login credentials
          - button [ref=e9] [cursor=pointer]:
            - img [ref=e10]
    - region "Notifications alt+T"
    - generic [ref=e15]:
      - generic [ref=e16]:
        - img "Fliesentechnik Tilger" [ref=e17]
        - heading "Fliesentechnik Tilger" [level=3] [ref=e18]
        - paragraph [ref=e19]: Baustellendokumentation & Zeiterfassung
      - generic [ref=e21]:
        - generic [ref=e22]:
          - button "Anmelden" [ref=e23] [cursor=pointer]
          - button "Registrieren" [ref=e24] [cursor=pointer]
        - generic [ref=e25]:
          - generic [ref=e26]:
            - text: E-Mail
            - textbox "E-Mail" [ref=e27]:
              - /placeholder: ihre@email.at
              - text: fake@test.com
          - generic [ref=e28]:
            - text: Passwort
            - textbox "Passwort" [ref=e29]: wrongpassword
          - button "Passwort vergessen?" [ref=e30] [cursor=pointer]
          - button "Anmelden" [ref=e31] [cursor=pointer]
  - status [ref=e32]: Notification Fehler beim AnmeldenInvalid login credentials
```