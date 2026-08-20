import os
from PIL import Image, ImageDraw, ImageFont

def render_slides():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    hotel_dir = os.path.join(base_dir, "public", "assets", "hotel")
    out_dir = os.path.join(base_dir, "presentation_slides")
    public_pres_dir = os.path.join(base_dir, "public", "assets", "presentation")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(public_pres_dir, exist_ok=True)

    WIDTH = 1920
    HEIGHT = 1080

    # Colors
    BG_COLOR = (11, 13, 18)        # #0B0D12
    CARD_BG = (20, 24, 34)         # #141822
    CARD_BORDER = (212, 175, 55)   # Gold #D4AF37
    BORDER_MUTED = (45, 55, 72)
    GOLD = (212, 175, 55)
    GOLD_LIGHT = (245, 215, 110)
    TEXT_WHITE = (248, 250, 252)
    TEXT_MUTED = (160, 174, 192)

    # Fonts
    font_path_bold = "C:\\Windows\\Fonts\\segoeuib.ttf"
    font_path_reg = "C:\\Windows\\Fonts\\segoeui.ttf"
    font_path_serif = "C:\\Windows\\Fonts\\georgiab.ttf"

    def get_font(path, size):
        try:
            return ImageFont.truetype(path, size)
        except:
            return ImageFont.load_default()

    f_hero_title = get_font(font_path_serif, 56)
    f_slide_title = get_font(font_path_bold, 36)
    f_cat = get_font(font_path_bold, 18)
    f_card_h = get_font(font_path_bold, 22)
    f_card_sub = get_font(font_path_bold, 18)
    f_body = get_font(font_path_reg, 18)
    f_body_bold = get_font(font_path_bold, 18)
    f_price = get_font(font_path_bold, 24)
    f_small = get_font(font_path_reg, 15)

    def create_base_slide(cat_text, title_text):
        img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
        draw = ImageDraw.Draw(img)

        # Header Category
        draw.text((100, 50), cat_text.upper(), font=f_cat, fill=GOLD)
        # Title
        draw.text((100, 85), title_text, font=f_slide_title, fill=TEXT_WHITE)
        # Gold underline
        draw.line([(100, 150), (WIDTH - 100, 150)], fill=GOLD, width=3)
        # Footer
        draw.text((100, HEIGHT - 60), "RICHMAN ESTATE • PROJET LÉGAL RP • LOS SANTOS", font=f_small, fill=TEXT_MUTED)
        draw.text((WIDTH - 450, HEIGHT - 60), "https://richman-estate.vercel.app/", font=f_small, fill=GOLD)

        return img, draw

    def draw_card(draw, x, y, w, h, border=CARD_BORDER, bg=CARD_BG, radius=12):
        draw.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=bg, outline=border, width=2)

    # -------------------------------------------------------------
    # SLIDE 1 : COUVERTURE
    # -------------------------------------------------------------
    s1 = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    d1 = ImageDraw.Draw(s1)

    # Right side photo
    img_facade_path = os.path.join(hotel_dir, "01_facade_nuit.jpg")
    if os.path.exists(img_facade_path):
        facade = Image.open(img_facade_path).resize((900, 880))
        s1.paste(facade, (WIDTH - 980, 100))
        d1.rectangle([WIDTH - 980, 100, WIDTH - 80, 980], outline=GOLD, width=3)

    # Left Card
    draw_card(d1, 100, 100, 800, 880, border=GOLD, bg=CARD_BG)
    
    # Badge
    d1.rounded_rectangle([150, 160, 420, 210], radius=8, fill=GOLD)
    d1.text((175, 172), "PROJET LÉGAL RP", font=f_cat, fill=BG_COLOR)

    # Title
    d1.text((150, 250), "RICHMAN ESTATE", font=f_hero_title, fill=TEXT_WHITE)
    d1.text((150, 330), "Hôtellerie de Prestige • Supercars • Événementiel", font=f_card_h, fill=GOLD_LIGHT)
    d1.line([(150, 380), (750, 380)], fill=BORDER_MUTED, width=2)

    # Info list
    infos = [
        ("📍 Localisation :", "Manoir de Richman (Richman Hills / Rockford Dr)"),
        ("👑 Direction :", "Antonio Depresto (#3932) & Alex Breacker (#4526)"),
        ("🌐 Site Web :", "https://richman-estate.vercel.app/"),
        ("💬 Discord :", "https://discord.gg/bdJhGdP3t9"),
        ("🛡️ Statut :", "100% Autonome • Zéro script requis • RP Pur")
    ]
    cur_y = 420
    for label, val in infos:
        d1.text((150, cur_y), label, font=f_body_bold, fill=GOLD)
        d1.text((150, cur_y + 30), val, font=f_body, fill=TEXT_WHITE)
        cur_y += 85

    # -------------------------------------------------------------
    # SLIDE 2 : HISTOIRE ROLEPLAY
    # -------------------------------------------------------------
    s2, d2 = create_base_slide("HISTOIRE & ORIGINES", "Histoire Roleplay & Continuité du Domaine")
    col_w = 540
    card_h = 750
    start_y = 190

    h_data = [
        ("1. LES ORIGINES (GENESIS)", [
            "Le domaine de Richman et le Golf Club sont des repères historiques pour Antonio Depresto et Alex Breacker.",
            "",
            "À l'époque, Antonio était employé chez Genesis Security, entreprise basée au Manoir de Richman.",
            "",
            "À sa fermeture définitive, Alex Breacker a racheté l'ensemble de la flotte de sécurité et les droits sur le domaine pour y fonder Spartan Security."
        ]),
        ("2. L'ÈRE SPARTAN SECURITY", [
            "Antonio a rejoint Spartan Security aux côtés d'Alex.",
            "",
            "Grâce à sa rigueur et sa parfaite maîtrise du terrain, il est rapidement devenu cadre au sein de l'équipe d'une vingtaine d'agents.",
            "",
            "Le Manoir de Richman a été leur quartier général et le centre de leurs opérations pendant de longs mois."
        ]),
        ("3. RENAISSANCE : RICHMAN ESTATE", [
            "Après la restitution temporaire du domaine à l'État, Antonio et Alex s'associent d'égal à égal.",
            "",
            "Forts de leur maîtrise parfaite des lieux, ils fondent Richman Estate : un complexe hôtelier de prestige.",
            "",
            "Ils y intègrent la location de leur collection privée de supercars rarissimes (Krieger, Furia, Deveste Eight)."
        ])
    ]

    for i, (head, text_lines) in enumerate(h_data):
        x = 100 + i * (col_w + 50)
        draw_card(d2, x, start_y, col_w, card_h, border=GOLD if i == 2 else BORDER_MUTED)
        d2.text((x + 30, start_y + 30), head, font=f_card_h, fill=GOLD)
        d2.line([(x + 30, start_y + 70), (x + col_w - 30, start_y + 70)], fill=BORDER_MUTED, width=1)
        
        y_text = start_y + 90
        for line in text_lines:
            if line == "":
                y_text += 15
                continue
            # Simple text wrap
            words = line.split(" ")
            wrapped = ""
            for w in words:
                if len(wrapped + " " + w) < 42:
                    wrapped += (" " if wrapped else "") + w
                else:
                    d2.text((x + 30, y_text), wrapped, font=f_body, fill=TEXT_WHITE)
                    y_text += 26
                    wrapped = w
            if wrapped:
                d2.text((x + 30, y_text), wrapped, font=f_body, fill=TEXT_WHITE)
                y_text += 26

    # -------------------------------------------------------------
    # SLIDE 3 : SERVICES & ACTIVITÉS
    # -------------------------------------------------------------
    s3, d3 = create_base_slide("ACTIVITÉS & SERVICES", "Description de l’Entreprise & Services Proposés")
    serv_data = [
        ("🏨 HÔTELLERIE & RÉSIDENCES", [
            "• Hébergement de standing en chambres prestige & suites exécutives.",
            "• Accès complet aux infrastructures de détente : piscine, courts de tennis, terrasses et espaces lounges.",
            "• Service de conciergerie haut de gamme pour séjours d'affaires ou villégiature."
        ]),
        ("🏎️ LOCATION DE SUPERCARS", [
            "• Mise à disposition exclusive de supercars et sportives rares de collection privée.",
            "• Véhicules dédiés aux cérémonies, mariages, shootings ou sorties d'exception.",
            "• Encadrement 100% RP : contrat officiel, permis valide, caution obligatoire et remise des clés RP."
        ]),
        ("✨ ÉVÉNEMENTIEL & RÉCEPTIONS", [
            "• Privatisation totale du domaine pour galas, mariages et réceptions d'entreprises.",
            "• Organisation d'événements exclusifs ouverts au public (soirées lounge, expositions de supercars).",
            "• Partenariats institutionnels avec le Gouvernement et la Justice."
        ])
    ]

    for i, (head, text_lines) in enumerate(serv_data):
        x = 100 + i * (col_w + 50)
        draw_card(d3, x, start_y, col_w, card_h, border=GOLD)
        d3.text((x + 30, start_y + 30), head, font=f_card_h, fill=GOLD)
        d3.line([(x + 30, start_y + 70), (x + col_w - 30, start_y + 70)], fill=BORDER_MUTED, width=1)
        
        y_text = start_y + 100
        for line in text_lines:
            words = line.split(" ")
            wrapped = ""
            for w in words:
                if len(wrapped + " " + w) < 40:
                    wrapped += (" " if wrapped else "") + w
                else:
                    d3.text((x + 30, y_text), wrapped, font=f_body, fill=TEXT_WHITE)
                    y_text += 28
                    wrapped = w
            if wrapped:
                d3.text((x + 30, y_text), wrapped, font=f_body, fill=TEXT_WHITE)
                y_text += 35

    # -------------------------------------------------------------
    # SLIDE 4 : FLOTTE AUTOMOBILE & MODALITÉS RP
    # -------------------------------------------------------------
    s4, d4 = create_base_slide("FLOTTE & VÉHICULES", "Flotte Automobile d'Exception & Encadrement RP")
    card_w_half = 830

    # Left: Fleet
    draw_card(d4, 100, start_y, card_w_half, card_h, border=GOLD)
    d4.text((130, start_y + 30), "🏎️ CATALOGUE DE LA FLOTTE PRESTIGE", font=f_card_h, fill=GOLD)
    d4.line([(130, start_y + 70), (130 + card_w_half - 60, start_y + 70)], fill=BORDER_MUTED, width=1)

    fleet_lines = [
        ("Supercars de Collection Privée :", GOLD_LIGHT, True),
        ("• Benefactor Krieger — Hypercar allemande de prestige", TEXT_WHITE, False),
        ("• Grotti Furia — Élégance et sonorité italienne d'exception", TEXT_WHITE, False),
        ("• Principe Deveste Eight — Design futuriste et ultra-sportif", TEXT_WHITE, False),
        ("", TEXT_WHITE, False),
        ("Berlines & Véhicules d'Honneur :", GOLD_LIGHT, True),
        ("• Enus Super Diamond — Berline de luxe britannique pour cortèges", TEXT_WHITE, False),
        ("• Gallivanter Baller LWB — SUV blindé de standing pour escortes", TEXT_WHITE, False),
        ("", TEXT_WHITE, False),
        ("Origine des véhicules :", GOLD, True),
        ("Tous les véhicules sont déjà possédés légalement par les gérants ou achetés via les concessions du serveur.", TEXT_MUTED, False)
    ]
    cur_y = start_y + 90
    for txt, color, is_bold in fleet_lines:
        if txt == "":
            cur_y += 10
            continue
        d4.text((130, cur_y), txt, font=f_body_bold if is_bold else f_body, fill=color)
        cur_y += 32

    # Right: RP Rules
    draw_card(d4, 990, start_y, card_w_half, card_h, border=BORDER_MUTED)
    d4.text((1020, start_y + 30), "📋 GESTION 100% RP DE LA LOCATION", font=f_card_h, fill=GOLD)
    d4.line([(1020, start_y + 70), (1020 + card_w_half - 60, start_y + 70)], fill=BORDER_MUTED, width=1)

    rp_rules = [
        ("✓ Prêt de clés autonome :", "Géré via les commandes natives du serveur (/donnercle, /givekey ou échange direct d'items). Aucun script custom demandé."),
        ("✓ Contrat & Permis RP :", "Vérification stricte de l'identité et du permis de conduire. Signature d'un contrat de bail officiel."),
        ("✓ Caution Obligatoire :", "Versement d'une caution garantie par facture/virement, restituée lors du retour après inspection complète."),
        ("✓ Restitution & Sanctions :", "État des lieux complet. En cas de dégradation ou non-restitution : rétention de caution, plainte RP à la police et saisine de la justice.")
    ]
    cur_y = start_y + 90
    for head, body in rp_rules:
        d4.text((1020, cur_y), head, font=f_body_bold, fill=GOLD)
        cur_y += 28
        # Wrap body
        words = body.split(" ")
        wrapped = ""
        for w in words:
            if len(wrapped + " " + w) < 55:
                wrapped += (" " if wrapped else "") + w
            else:
                d4.text((1020, cur_y), wrapped, font=f_body, fill=TEXT_WHITE)
                cur_y += 26
                wrapped = w
        if wrapped:
            d4.text((1020, cur_y), wrapped, font=f_body, fill=TEXT_WHITE)
            cur_y += 40

    # -------------------------------------------------------------
    # SLIDE 5 : GRILLE TARIFAIRE
    # -------------------------------------------------------------
    s5, d5 = create_base_slide("TARIFS & PRESTATIONS", "Grille Tarifaire des Services & Prestations")
    tarifs = [
        ("HÉBERGEMENT", [
            ("Chambre Prestige", "1 500 $", "/ nuitée"),
            ("Suite Exécutive / Penthouse", "3 500 $", "/ nuitée"),
            ("Accès Détente & Piscine", "500 $", "/ personne / jour")
        ]),
        ("LOCATION SUPERCARS", [
            ("Location Supercar (Krieger / Furia)", "5 000 $ à 8 000 $", "/ jour"),
            ("Caution Obligatoire", "10 000 $ à 20 000 $", "(restituée au retour)"),
            ("Option Chauffeur Privé", "1 500 $", "/ événement")
        ]),
        ("PRIVATISATION & ÉVÉNEMENTS", [
            ("Privatisation Manoir (Soirée)", "15 000 $ à 25 000 $", "/ événement"),
            ("Réception / Gala Entreprise", "Sur Devis", "selon prestations"),
            ("Shooting Photo & Tournage", "3 000 $", "/ demi-journée")
        ])
    ]

    for i, (cat_title, rows) in enumerate(tarifs):
        x = 100 + i * (col_w + 50)
        draw_card(d5, x, start_y, col_w, card_h, border=GOLD)
        d5.text((x + 30, start_y + 30), cat_title, font=f_card_h, fill=GOLD)
        d5.line([(x + 30, start_y + 70), (x + col_w - 30, start_y + 70)], fill=BORDER_MUTED, width=1)

        y_row = start_y + 95
        for name, price, sub in rows:
            d5.text((x + 30, y_row), name, font=f_card_sub, fill=TEXT_WHITE)
            y_row += 30
            d5.text((x + 30, y_row), price, font=f_price, fill=GOLD_LIGHT)
            d5.text((x + 30 + len(price)*14 + 20, y_row + 4), sub, font=f_small, fill=TEXT_MUTED)
            y_row += 60

    # -------------------------------------------------------------
    # SLIDE 6 : ORGANIGRAMME & DRESS CODE
    # -------------------------------------------------------------
    s6, d6 = create_base_slide("ÉQUIPE & PROTOCOLE", "Organigramme, Effectifs & Code Vestimentaire")
    draw_card(d6, 100, start_y, card_w_half, card_h, border=GOLD)
    d6.text((130, start_y + 30), "👥 STRUCTURE DES EFFECTIFS (< 30)", font=f_card_h, fill=GOLD)
    d6.line([(130, start_y + 70), (130 + card_w_half - 60, start_y + 70)], fill=BORDER_MUTED, width=1)

    org_items = [
        ("Direction Générale :", "PDG Antonio Depresto (#3932) & Co-PDG Alex Breacker (#4526)"),
        ("Pôle Hôtellerie & Accueil :", "1x Responsable Accueil + 2x Réceptionnistes / Intendance"),
        ("Pôle Flotte & Location :", "1x Responsable Flotte + 2x Préparateurs & Contrôleurs"),
        ("Pôle Événementiel :", "1x Chargé d'Événements & Relations Publiques"),
        ("Processus de Recrutement :", "Entretiens RP rigoureux avec contrat de travail légal en jeu.")
    ]
    cur_y = start_y + 90
    for head, val in org_items:
        d6.text((130, cur_y), head, font=f_body_bold, fill=GOLD_LIGHT)
        cur_y += 28
        d6.text((130, cur_y), val, font=f_body, fill=TEXT_WHITE)
        cur_y += 45

    draw_card(d6, 990, start_y, card_w_half, card_h, border=BORDER_MUTED)
    d6.text((1020, start_y + 30), "👔 CODE VESTIMENTAIRE (DRESS CODE)", font=f_card_h, fill=GOLD)
    d6.line([(1020, start_y + 70), (1020 + card_w_half - 60, start_y + 70)], fill=BORDER_MUTED, width=1)

    dress_items = [
        ("👔 Direction :", "Costumes 3 pièces sur-mesure, montres de collection, tenues de gala."),
        ("🤵 Accueil & Réception :", "Costumes noirs cintrés, chemises blanches, cravates ou nœuds papillon soignés."),
        ("🚗 Flotte & Logistique :", "Chemises blanches élégantes, gilets de service noirs, pantalons de ville habillés."),
        ("✨ Cohérence d'Excellence :", "Présentation irréprochable reflétant le luxe et le prestige du domaine.")
    ]
    cur_y = start_y + 90
    for head, val in dress_items:
        d6.text((1020, cur_y), head, font=f_body_bold, fill=GOLD_LIGHT)
        cur_y += 28
        d6.text((1020, cur_y), val, font=f_body, fill=TEXT_WHITE)
        cur_y += 45

    # -------------------------------------------------------------
    # SLIDE 7 : OBJECTIFS & SYNERGIES RP
    # -------------------------------------------------------------
    s7, d7 = create_base_slide("VISION & INTERACTIONS", "Objectifs Court/Long Terme & Synergies RP")
    draw_card(d7, 100, start_y, card_w_half, card_h, border=GOLD)
    d7.text((130, start_y + 30), "🎯 OBJECTIFS DE DÉVELOPPEMENT", font=f_card_h, fill=GOLD)
    d7.line([(130, start_y + 70), (130 + card_w_half - 60, start_y + 70)], fill=BORDER_MUTED, width=1)

    objs_list = [
        ("Court terme :", [
            "• Scène RP d'acquisition officielle avec le Gouvernement.",
            "• Mise en service du parc de supercars et contrats de location.",
            "• Recrutement et formation de l'équipe de réception.",
            "• Grande soirée d'inauguration avec exposition automobile."
        ]),
        ("Long terme :", [
            "• Devenir le pôle d'hôtellerie de luxe incontournable de Los Santos.",
            "• Contrats réguliers de privatisation (galas d'État, réceptions d'entreprises).",
            "• Organisation de concours d'élégance et rassemblements de supercars."
        ])
    ]
    cur_y = start_y + 90
    for head, points in objs_list:
        d7.text((130, cur_y), head, font=f_card_sub, fill=GOLD_LIGHT)
        cur_y += 30
        for pt in points:
            d7.text((130, cur_y), pt, font=f_body, fill=TEXT_WHITE)
            cur_y += 30
        cur_y += 15

    draw_card(d7, 990, start_y, card_w_half, card_h, border=BORDER_MUTED)
    d7.text((1020, start_y + 30), "🤝 SYNERGIES & INTERACTIONS EN VILLE", font=f_card_h, fill=GOLD)
    d7.line([(1020, start_y + 70), (1020 + card_w_half - 60, start_y + 70)], fill=BORDER_MUTED, width=1)

    syn_items = [
        ("🏛️ Gouvernement & Justice :", "Accueil de séminaires d'État, galas officiels et réceptions protocolaires."),
        ("🔧 Garages & Concessions :", "Contrats réguliers d'entretien complet, révisions et pneumatiques pour la flotte."),
        ("📰 Weazel News & Médias :", "Campagnes de communication, couverture des événements et interviews mondaines."),
        ("🍸 Commerces & Traiteurs :", "Approvisionnement local régulier pour les buffets, cocktails et réceptions.")
    ]
    cur_y = start_y + 90
    for head, val in syn_items:
        d7.text((1020, cur_y), head, font=f_body_bold, fill=GOLD_LIGHT)
        cur_y += 28
        d7.text((1020, cur_y), val, font=f_body, fill=TEXT_WHITE)
        cur_y += 45

    # -------------------------------------------------------------
    # SLIDE 8 : ENGAGEMENTS STAFF
    # -------------------------------------------------------------
    s8, d8 = create_base_slide("ENGAGEMENTS & CONFORMITÉ", "Engagements HRP & Respect Strict du Règlement")
    draw_card(d8, 100, start_y, WIDTH - 200, card_h, border=GOLD)
    
    engagements = [
        ("✅ 0 SCRIPT / 0 DÉVELOPPEMENT REQUIS :", "L'entreprise est 100% autonome et utilise uniquement les fonctionnalités existantes du serveur (commandes de clés de base, facturation, virements bancaires, contrats RP)."),
        ("✅ 0 MAPPING / 0 WHITELIST SPÉCIALE :", "Le domaine sera exploité dans son état naturel sur la carte, sans aucune charge technique ni demande de développement pour le staff."),
        ("✅ 0 DEMANDE D'ARMES OU DE VÉHICULES AU STAFF :", "L'intégralité de la flotte provient de nos véhicules propres déjà légalement possédés et immatriculés en ville."),
        ("✅ ACQUISITION DU LIEU EN SCÈNE RP :", "L'acquisition officielle et l'accord pour le domaine seront intégralement joués en scène RP auprès des représentants du Gouvernement."),
        ("✅ RESPECT STRICT DES EFFECTIFS (< 30) :", "Effectif d'équipe maîtrisé à taille humaine, garantissant une qualité de Roleplay constante et de fortes interactions citoyennes.")
    ]

    cur_y = start_y + 60
    for head, body in engagements:
        d8.text((140, cur_y), head, font=f_card_h, fill=GOLD)
        cur_y += 35
        # wrap body
        words = body.split(" ")
        wrapped = ""
        for w in words:
            if len(wrapped + " " + w) < 95:
                wrapped += (" " if wrapped else "") + w
            else:
                d8.text((140, cur_y), wrapped, font=f_body, fill=TEXT_WHITE)
                cur_y += 28
                wrapped = w
        if wrapped:
            d8.text((140, cur_y), wrapped, font=f_body, fill=TEXT_WHITE)
            cur_y += 45

    # Save all slides
    slides = [
        ("01_couverture.png", s1),
        ("02_histoire.png", s2),
        ("03_services.png", s3),
        ("04_flotte.png", s4),
        ("05_tarifs.png", s5),
        ("06_organigramme_tenues.png", s6),
        ("07_objectifs_synergies.png", s7),
        ("08_engagements_hrp.png", s8)
    ]

    for filename, img_obj in slides:
        p1 = os.path.join(out_dir, filename)
        p2 = os.path.join(public_pres_dir, filename)
        img_obj.save(p1, "PNG", quality=95)
        img_obj.save(p2, "PNG", quality=95)
        print(f"Generated: {filename}")

if __name__ == "__main__":
    render_slides()
