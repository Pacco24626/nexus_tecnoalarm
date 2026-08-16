import sys
import os

# Aggiungi custom_components/nexus_tecnoalarm al path per poter importare presence.py direttamente
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'custom_components', 'nexus_tecnoalarm')))

try:
    import presence
except ImportError as e:
    print(f"Errore di importazione: {e}")
    sys.exit(1)

def run_tests():
    should_ping = presence.should_ping
    
    # 1. presenza recente dentro finestra -> True
    if not should_ping(100.0, 96.0, 15.0):
        print("FALLITO: presenza recente dentro finestra dovrebbe essere True")
        sys.exit(1)
        
    # 2. presenza vecchia oltre finestra -> False
    if should_ping(100.0, 80.0, 15.0):
        print("FALLITO: presenza vecchia oltre finestra dovrebbe essere False")
        sys.exit(1)
        
    # 3. confine esatto -> False
    if should_ping(100.0, 85.0, 15.0):
        print("FALLITO: confine esatto dovrebbe essere False")
        sys.exit(1)
        
    # 4. last_presence is None -> False
    if should_ping(100.0, None, 15.0):
        print("FALLITO: last_presence None dovrebbe essere False")
        sys.exit(1)

    print("PRESENCE: TUTTI I CONTROLLI SUPERATI")
    sys.exit(0)

if __name__ == "__main__":
    run_tests()
