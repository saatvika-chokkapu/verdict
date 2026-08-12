# Cost Model Assumptions

## From real data (this project's dataset)
- Fraud rate: 3.499% (590,540 transactions, 20,663 labeled fraud)
- Source: IEEE-CIS Fraud Detection dataset (Kaggle)

## From industry research (not derived from this dataset)
- False decline cost ratio: ~9x fraud loss, per Section 2 of the project manual
- Customer churn after false decline: ~39% (cited industry figure)

These industry figures are used to weight the cost function in `backend/cost_model.py`,
since the IEEE-CIS dataset has no churn or lifetime-value data of its own. The
`cost_multiplier` parameter on `decide_transaction()` exists specifically to let you
stress-test how sensitive the approve/decline decision is to these assumptions.
