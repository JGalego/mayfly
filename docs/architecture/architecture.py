"""Mayfly's architecture, drawn with each component's logo. Run `pixi run diagram` after changing it."""

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.custom import Custom
from diagrams.generic.device import Mobile
from diagrams.onprem.auth import Oauth2Proxy
from diagrams.onprem.client import Client
from diagrams.onprem.identity import Dex

HERE = Path(__file__).parent

GRAPH = {"fontname": "Helvetica", "pad": "1.1", "nodesep": "0.9", "ranksep": "1.4", "splines": "spline"}
NODE = {"fontname": "Helvetica", "fontsize": "18"}
EDGE = {"fontname": "Helvetica", "fontsize": "16", "color": "#6b7280", "fontcolor": "#374151"}
TAILNET = {"style": "dashed"}
# Labels under icons are wider than the icons, and Graphviz sizes a box by the icons alone: the margin keeps the labels inside.
BOX = {"fontname": "Helvetica", "fontsize": "18", "margin": "44"}


def logo(name: str) -> str:
    return str(HERE / "logos" / f"{name}.png")


def label(name: str, what: str = "") -> str:
    """
    A node's name in bold, and what it does under it. diagrams makes a node taller for each newline in its label, which an
    HTML label otherwise ignores: one more than the lines keeps large text clear of the icon.
    """
    return f"<<b>{name}</b>" + (f"<br/>\n{what}" if what else "") + "\n>"


def link(label: str = "", **style: str) -> Edge:
    """An edge, its label as large as the diagram's: diagrams gives each edge a font size of its own."""
    return Edge(label=label, **EDGE, **style)


with Diagram("", filename=str(HERE / "architecture"), outformat="png", show=False, direction="LR", graph_attr=GRAPH, node_attr=NODE, edge_attr=EDGE):
    phone = Mobile(label("Your phone", "and people you share with"))
    model = Custom(label("Model provider", "OpenAI-compatible"), logo("openai"))
    mail = Custom(label("Your mail server", "if you add one"), logo("mail"))

    with Cluster("Your computer", graph_attr=BOX):
        browser = Client(label("Your browser"))
        serve = Custom(label("Tailscale Serve", "HTTPS on your tailnet"), logo("tailscale"))

        with Cluster("Podman Desktop", graph_attr=BOX):
            mayfly = Custom(label("Mayfly extension"), logo("mayfly"))

        with Cluster("Podman", graph_attr=BOX):
            podman = Custom(label("Podman", "builds and runs"), logo("podman"))

            with Cluster("One pod per app", graph_attr=BOX):
                # Two containers of the same image, one for each way in: drawn as one, so no lines cross.
                doors = Oauth2Proxy(label("oauth2-proxy", "a door per way in"))
                app = Custom(label("Generated app", "Hono on Node.js"), logo("hono"))

            with Cluster("Sign-in", graph_attr=BOX):
                dex = Dex(label("Dex"))
                sessions = Custom(label("Sessions", "on a volume"), logo("sqlite"))

    mayfly >> link("what you ask,\nthe app's code") >> model
    mayfly >> link("sign-ins and links,\nover TLS") >> mail
    mayfly >> link("routes.ts") >> podman
    browser >> link("127.0.0.1") >> doors
    phone >> link("tailnet", **TAILNET) >> serve >> link(**TAILNET) >> doors
    doors >> link("identity headers") >> app
    doors >> link("OIDC") >> dex
    dex >> link() >> sessions
